#!/usr/bin/env python3
"""Gather ground-truth facts about every staged asset + bundle, into one JSON.
Runs inside tess-media. The verification workflow reasons over this, it does not re-probe."""
import json, os, subprocess

STAGE = "/app/media/showcase-stage"
CAP = "/app/media/showcase-capture"
SEC = {  # section -> jobId (latest good bundle)
 "01":"4c24c6c5-f9c3-472e-99dd-7b384655796d","02":"4d9e4b4d-b6d8-41c8-9b20-1e01ff11ddee",
 "03":"85271098-75a3-47f7-b056-a6538b6dda51","04":"e2cda170-e6d3-4c0b-b064-cc5ce8430ab3",
 "05":"ddb14af7-5484-4267-af05-8618352bc508","06":"a918fffa-92b2-4a85-8537-bfafe0a768a7",
 "07":"9d6eb78e-258a-45b6-8189-2fc2abe5fa32","08":"55c53d9b-cdef-4980-880b-3f88cd760160",
 "09":"0b048e58-ed26-4bf1-bd3e-21c30d1fc96e","10":"8a071df3-6efa-4f70-b122-347342c58224",
 "11":"72d2b2f8-bd18-44be-8901-1ec3c8d5b599","12":"3690818d-8bde-4541-bdab-6cad1cc34ba3",
 "13":"085999dc-0135-4b64-ac64-55293dc7496a","14":"e74f5c62-52b1-41ee-a497-51a5590320de",
 "15":"fcbfdddb-5505-43c6-9fcd-6cf784bde51c","16":"dfffbb7c-25d1-4238-be8b-8c5712c41f55",
 "17":"2427f09b-6653-44a3-b9e4-16a0b0513dae","18":"66ed898a-5b1e-44b8-91e4-d4338ec29046",
}

def probe(path, streams="v"):
    r = subprocess.run(["ffprobe","-v","error","-select_streams",streams,
        "-show_entries","stream=width,height,pix_fmt,duration","-of","json",path],
        capture_output=True,text=True)
    try: return json.loads(r.stdout)["streams"][0]
    except Exception: return None

def dur(path):
    r = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
        "-of","csv=p=0",path],capture_output=True,text=True)
    try: return float(r.stdout.strip())
    except Exception: return None

out = {}
for n, jid in SEC.items():
    b = f"{CAP}/{jid}/16x9uhd"
    meta = json.load(open(f"{b}/meta.json"))
    scenes = meta["scenes"]
    total = sum(s["durMs"] for s in scenes)/1000
    body = probe(f"{b}/body.mp4")
    cuesf = f"{STAGE}/section-{n}/cues.json"
    cues = json.load(open(cuesf)) if os.path.exists(cuesf) else []
    capdir = f"{STAGE}/section-{n}/captions-4k"
    pngs = sorted(f for f in os.listdir(capdir) if f.endswith(".png")) if os.path.isdir(capdir) else []
    # sample first, middle, last png for dims + alpha
    samp = {}
    for tag,i in (("first",0),("mid",len(pngs)//2),("last",len(pngs)-1)):
        if pngs:
            s = probe(f"{capdir}/{pngs[i]}")
            samp[tag] = None if not s else {"w":s.get("width"),"h":s.get("height"),"pix":s.get("pix_fmt")}
    rec = {
        "section": int(n), "jobId": jid,
        "sceneCount": len(scenes),
        "totalSec": round(total,3),
        "body": None if not body else {"w":body.get("width"),"h":body.get("height")},
        "srcOffsetsLen": len(meta["recording"]["srcOffsetsMs"]),
        "cuesCount": len(cues),
        "pngCount": len(pngs),
        "captionSample": samp,
        "firstCueStart": cues[0]["start"] if cues else None,
        "lastCueEnd": cues[-1]["end"] if cues else None,
        "cuesMonotonic": all(cues[i]["start"] <= cues[i+1]["start"] for i in range(len(cues)-1)),
        "cueOverEnd": bool(cues and cues[-1]["end"] > total + 0.05),
        "silentScenes": [s["id"] for s in scenes if not (s.get("voWords"))],
    }
    if n == "18":
        cA = f"{STAGE}/section-18/card-A-4k.png"; cB = f"{STAGE}/section-18/card-B-4k.png"
        arch = f"{STAGE}/section-18/arch-4k.mov"
        rec["card_A"] = probe(cA) and {"w":probe(cA)["width"],"h":probe(cA)["height"],"pix":probe(cA)["pix_fmt"]}
        rec["card_B"] = probe(cB) and {"w":probe(cB)["width"],"h":probe(cB)["height"],"pix":probe(cB)["pix_fmt"]}
        rec["arch"] = None
        if os.path.exists(arch):
            s = probe(arch)
            rec["arch"] = {"w":s and s.get("width"),"h":s and s.get("height"),
                           "pix":s and s.get("pix_fmt"),"dur":dur(arch)}
    out[n] = rec

print(json.dumps(out, indent=1))
