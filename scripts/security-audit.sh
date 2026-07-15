#!/usr/bin/env bash
# Security posture watcher — READ-ONLY, no sudo, makes NO changes.
#
# Tess/the console can't (and shouldn't) run sudo, so this just *observes* the box and
# *reports*: it writes a snapshot to settings.security_audit (rendered in the console)
# and raises de-duped notifications for anything actionable — each with a COPY-PASTE
# sudo command the admin runs. Deterministic; runs even while Tess is paused. Reports
# into the Jobs Monitor. Mirrors collect-vps-health.sh / rate-watchdog.sh conventions.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "security-audit" || { echo "$(date -Is) security-audit: paused (jobs monitor), skipping"; exit 0; }
. ./.env
START=$(date +%s%3N)

PSQL() { docker exec tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
esc() { printf '%s' "$1" | sed "s/'/''/g"; }

# Notify, but not more than once per DEDUP_H hours for the same title (avoid nagging).
DEDUP_H=12
notify() { # severity title body
  local recent
  recent=$(PSQL -c "SELECT 1 FROM notifications WHERE module='security' AND title='$(esc "$2")' AND created_at >= now() - interval '${DEDUP_H} hours' LIMIT 1;")
  [ -n "$recent" ] && return 0
  PSQL -c "INSERT INTO notifications (severity,title,body,module) VALUES ('$1','$(esc "$2")','$(esc "$3")','security');" >/dev/null
}

findings=()                 # short human strings → snapshot
worst="ok"
bump() { case "$1" in critical) worst="critical";; warning) [ "$worst" = critical ] || worst="warning";; esac; }

# 1) Pending package updates. apt-check prints "total;security" (non-root).
#    SEC     = security updates apt-check reports (snapshot only).
#    SEC_NOW = security updates a `full-upgrade` will ACTUALLY install today.
#    We alert on SEC_NOW, not SEC: phased / kept-back security updates show up
#    in SEC but `full-upgrade` won't pull them until Ubuntu phases them to this
#    box — nagging about those just cries wolf (the admin runs the command and
#    it's back the next day). The -s (simulate) run is phasing-aware, so the
#    only Inst lines from a *-security pocket are ones we can clear right now.
REG=0; SEC=0
if [ -x /usr/lib/update-notifier/apt-check ]; then
  OUT=$(/usr/lib/update-notifier/apt-check 2>&1 || true)
  REG=${OUT%;*}; SEC=${OUT#*;}
else
  REG=$(apt list --upgradable 2>/dev/null | grep -c upgradable || echo 0)
  SEC=$(apt list --upgradable 2>/dev/null | grep -ci security || echo 0)
fi
[[ "$REG" =~ ^[0-9]+$ ]] || REG=0
[[ "$SEC" =~ ^[0-9]+$ ]] || SEC=0
SEC_NOW=$(LC_ALL=C apt-get -s full-upgrade 2>/dev/null | awk '/^Inst/ && /:[^ ]*-security/ {c++} END{print c+0}')
[[ "$SEC_NOW" =~ ^[0-9]+$ ]] || SEC_NOW=0
if [ "$SEC_NOW" -gt 0 ]; then
  findings+=("$SEC_NOW security update(s) pending")
  bump critical
  # Static title (no count) so the DEDUP_H window actually holds — a changing
  # number in the title would defeat dedup and re-nag every run.
  notify critical "🔴 Security updates pending" "Your server has $SEC_NOW pending security update(s) ready to install. Apply them in your VPS terminal:

  sudo apt-get update && sudo apt-get full-upgrade -y

Use 'full-upgrade' (not plain 'upgrade') so security updates that are 'kept back' (version jumps) also install. No downtime; about a minute. (Tess can't run sudo — this one's yours.)"
fi

# 2) Reboot required after a patch (kernel/libc). Flag file, non-root.
if [ -f /var/run/reboot-required ]; then
  PKGS=$(tr '\n' ' ' < /var/run/reboot-required.pkgs 2>/dev/null)
  findings+=("reboot required")
  bump warning
  notify warning "🟡 Reboot needed to finish a security update" "A patched component needs a reboot to take effect${PKGS:+ ($PKGS)}. When convenient:

  sudo reboot

Roughly 30–60s downtime; the site comes back on its own."
fi

# 3) Firewall (ufw).
UFW=$(systemctl is-active ufw 2>/dev/null || echo unknown)
if [ "$UFW" != active ]; then
  findings+=("firewall (ufw) is $UFW")
  bump critical
  notify critical "🔴 Firewall is not active" "ufw is '$UFW'. Re-enable it (allows SSH/web first, so you won't be locked out):

  sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable"
fi

# 4) fail2ban (SSH brute-force protection).
F2B=$(systemctl is-active fail2ban 2>/dev/null || echo unknown)
if [ "$F2B" != active ]; then
  findings+=("fail2ban is $F2B")
  bump warning
  notify warning "🟡 fail2ban is not running" "Brute-force protection (fail2ban) is '$F2B'. Start it:

  sudo systemctl enable --now fail2ban"
fi

# 5) Monarx security agent (malware / web-shell / intrusion detection).
MONARX=$(systemctl is-active monarx-agent 2>/dev/null || echo not-installed)
if [ "$MONARX" != active ] && [ "$MONARX" != not-installed ]; then
  findings+=("monarx-agent is $MONARX")
  bump warning
  notify warning "🟡 Monarx security agent stopped" "The Monarx malware/intrusion agent is '$MONARX'. Restart it:

  sudo systemctl restart monarx-agent"
fi

# 6) SSH root login (the one SSH item flagged for the admin to decide on).
ROOTLOGIN=$(grep -hiE '^[[:space:]]*PermitRootLogin' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | awk '{print tolower($2)}' | tail -1)
if [ "${ROOTLOGIN:-}" = yes ]; then
  findings+=("SSH root login enabled")
  bump warning
  notify warning "🟡 SSH allows direct root login" "PermitRootLogin is 'yes'. Safer to turn it off (you log in as your normal user with a key). Optional fix — keep your current SSH window open and test a fresh login before closing it:

  sudo sed -i 's/^[[:space:]]*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && sudo systemctl restart ssh"
fi

# Externally-bound listening TCP ports (snapshot only — ufw may already block them).
PORTS=$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\])' | grep -oE '[0-9]+$' | sort -un | tr '\n' ',' | sed 's/,$//')

# Last successful apt/security run (epoch).
LASTSEC=null
for f in /var/lib/apt/periodic/update-success-stamp /var/log/unattended-upgrades/unattended-upgrades.log; do
  [ -e "$f" ] && { LASTSEC=$(stat -c %Y "$f" 2>/dev/null || echo null); break; }
done

# Snapshot for the console.
REBOOT=false; [ -f /var/run/reboot-required ] && REBOOT=true
FJSON=$(printf '"%s",' "${findings[@]}" 2>/dev/null); FJSON="[${FJSON%,}]"
SNAP="{\"checkedAt\":\"$(date -Is)\",\"severity\":\"$worst\",\"securityUpdates\":$SEC,\"totalUpdates\":$REG,\"rebootRequired\":$REBOOT,\"ufw\":\"$UFW\",\"fail2ban\":\"$F2B\",\"monarx\":\"$MONARX\",\"permitRootLogin\":\"${ROOTLOGIN:-unset}\",\"exposedPorts\":\"${PORTS}\",\"lastSecurityAt\":$LASTSEC,\"findings\":$FJSON}"
PSQL -c "INSERT INTO settings (key,value,updated_at) VALUES ('security_audit','$(esc "$SNAP")'::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=excluded.value, updated_at=now();" >/dev/null

SUMMARY="sec:${SEC} upd:${REG} ufw:${UFW} f2b:${F2B} monarx:${MONARX} reboot:${REBOOT} → ${worst}"
./scripts/report-job.sh "security-audit" "ok" "$(( $(date +%s%3N) - START ))" "$SUMMARY"
echo "$(date -Is) security-audit: $SUMMARY"
