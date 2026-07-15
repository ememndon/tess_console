#!/usr/bin/env bash
# Extra hardening from the Lynis baseline — RUN WITH sudo:
#   sudo /opt/tess-console/scripts/harden-extras.sh
#
# Applies ONLY the safe, high-value Lynis suggestions. Idempotent (safe to re-run).
# The SSH change is validated with `sshd -t` and reloaded (not restarted) only if
# valid, so it can't break your logins. Deliberately SKIPS disruptive/low-value
# items Lynis flags on a cloud VPS: separate /home /tmp /var partitions, GRUB
# password, and apt-listbugs (it can block unattended-upgrades).
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo:  sudo $0" >&2; exit 1; fi

echo "1) Apply pending updates, including 'kept back' ones (cloud-init, fwupd) ..."
apt-get update -qq
apt-get full-upgrade -y

echo "2) Install helpful security/patch-management packages ..."
apt-get install -y libpam-tmpdir debsums apt-show-versions

echo "3) login.defs: stricter default umask, stronger password hashing, password aging ..."
sed -i 's/^\s*UMASK.*/UMASK 027/' /etc/login.defs; grep -q '^UMASK' /etc/login.defs || echo 'UMASK 027' >> /etc/login.defs
grep -q '^SHA_CRYPT_MIN_ROUNDS' /etc/login.defs || echo 'SHA_CRYPT_MIN_ROUNDS 65536' >> /etc/login.defs
sed -i 's/^\s*PASS_MAX_DAYS.*/PASS_MAX_DAYS 365/' /etc/login.defs
sed -i 's/^\s*PASS_MIN_DAYS.*/PASS_MIN_DAYS 1/' /etc/login.defs

echo "4) Disable core dumps ..."
grep -q '^\* hard core 0' /etc/security/limits.conf || echo '* hard core 0' >> /etc/security/limits.conf
printf 'fs.suid_dumpable = 0\n' > /etc/sysctl.d/10-coredump.conf
sysctl --system >/dev/null 2>&1 || true

echo "5) Blacklist rarely-used kernel modules (dccp/sctp/rds/tipc + usb-storage) ..."
cat > /etc/modprobe.d/hardening-blacklist.conf <<'EOF'
install dccp /bin/true
install sctp /bin/true
install rds /bin/true
install tipc /bin/true
install usb-storage /bin/true
EOF

echo "6) Extra SSH hardening (validated before reload; root/password login already off) ..."
cat > /etc/ssh/sshd_config.d/10-tess-hardening-extra.conf <<'EOF'
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
if sshd -t 2>/dev/null; then
  systemctl reload ssh && echo "   SSH config valid -> reloaded."
else
  echo "   sshd -t FAILED -> reverting the SSH change (no risk to your logins)."
  rm -f /etc/ssh/sshd_config.d/10-tess-hardening-extra.conf
fi

echo
echo "Done. Re-check with:  sudo /opt/tess-console/scripts/lynis-baseline.sh"
echo "The hardening index should rise from 63; the 'vulnerable packages' warning should clear."
