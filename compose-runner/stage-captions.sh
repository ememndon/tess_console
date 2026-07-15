#!/bin/sh
# Stage 4K caption PNGs for all 18 sections. Run inside tess-media.
set -e
STAGE=/app/media/showcase-stage
for row in \
  "01:4c24c6c5-f9c3-472e-99dd-7b384655796d" \
  "02:4d9e4b4d-b6d8-41c8-9b20-1e01ff11ddee" \
  "03:85271098-75a3-47f7-b056-a6538b6dda51" \
  "04:e2cda170-e6d3-4c0b-b064-cc5ce8430ab3" \
  "05:ddb14af7-5484-4267-af05-8618352bc508" \
  "06:a918fffa-92b2-4a85-8537-bfafe0a768a7" \
  "07:9d6eb78e-258a-45b6-8189-2fc2abe5fa32" \
  "08:55c53d9b-cdef-4980-880b-3f88cd760160" \
  "09:0b048e58-ed26-4bf1-bd3e-21c30d1fc96e" \
  "10:8a071df3-6efa-4f70-b122-347342c58224" \
  "11:72d2b2f8-bd18-44be-8901-1ec3c8d5b599" \
  "12:3690818d-8bde-4541-bdab-6cad1cc34ba3" \
  "13:085999dc-0135-4b64-ac64-55293dc7496a" \
  "14:e74f5c62-52b1-41ee-a497-51a5590320de" \
  "15:fcbfdddb-5505-43c6-9fcd-6cf784bde51c" \
  "16:dfffbb7c-25d1-4238-be8b-8c5712c41f55" \
  "17:2427f09b-6653-44a3-b9e4-16a0b0513dae" \
  "18:66ed898a-5b1e-44b8-91e4-d4338ec29046" ; do
  n=${row%%:*}; jid=${row#*:}
  bundle=/app/media/showcase-capture/$jid/16x9uhd
  out=$STAGE/section-$n/captions-4k
  mkdir -p "$out"
  python3 /tmp/run.py --bundle "$bundle" --out x --dump-cues "$out/../cues.json" >/dev/null
  node /tmp/caption-pngs.mjs "$out/../cues.json" "$out" 2160 2>&1 | sed "s/^/  §$n /"
done
echo "ALL CAPTIONS STAGED"
