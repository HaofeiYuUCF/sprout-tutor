# Putting the Web Lab online (Render)

The site is one Docker web service on [Render](https://render.com). Render builds the `Dockerfile`
from this GitHub repository, gives the site an HTTPS address (`https://<name>.onrender.com`) and
keeps student work on a 1 GB disk mounted at `/data`.

Cost for the pilot: the Starter instance (about $7/month) plus the disk (about $0.25/month), and
the Anthropic API calls for AI hints (capped per student per day; curated hints cost nothing).

## What you need

- A Render account (sign up with GitHub), with a payment card on file. A disk needs a paid instance.
- An Anthropic API key **made just for this site**, with a monthly spending limit set in the
  Anthropic console. Do not reuse the laptop key.

## First deploy (about 15 minutes, most of it the first build)

1. Render dashboard → **New** → **Blueprint** → connect GitHub and pick `HaofeiYuUCF/sprout-tutor`.
   Render reads `render.yaml` and shows one service, `sprout-weblab`, with a disk.
2. It asks for the one secret, `ANTHROPIC_API_KEY`. Paste the new key there (it is stored by Render,
   never in the repository). To run without AI hints, leave it empty and set
   `SPROUT_LLM_PROVIDER` to `mock`.
3. Click **Apply**. The first build downloads the AVR compiler and takes about 5–10 minutes.
4. When the service shows **Live**, open `https://<name>.onrender.com/healthz`. It should show
   `"ok": true, "compiler": true, "cards": 5`.
5. Open `https://<name>.onrender.com/` (it goes to the Web Lab). Click **Try it as a guest**, pick
   card 1 and press **Check my code**: a green result means the server compiled it.
6. With an UNO plugged into your computer, run card 1 through to **Send to my board** in Chrome or
   Edge. Uploading happens in the browser, exactly as on the laptop.

`autoDeploy` is off: after pushing changes, press **Manual Deploy → Deploy latest commit**.

## Who can sign in

| Setting | Effect |
|---|---|
| `SPROUT_GUEST=1` (default in `render.yaml`) | "Try it as a guest" gives a random code. Good for reviewers and for trying the site. |
| A class list | Only codes on the list (and issued guest codes) can sign in. |
| `SPROUT_GUEST=0` and no class list | Nobody can sign in. |

To use a class list for a class session:

1. On the laptop: `python scripts/make_roster.py 24` → `data/roster_new.txt` (codes) and
   `data/roster_new.csv` (codes with an empty name column: fill in names and keep it offline).
2. Render → the service → **Environment** → **Secret Files** → add a file named `roster.txt` with
   the contents of `roster_new.txt`.
3. Add the environment variable `SPROUT_ROSTER=/etc/secrets/roster.txt`, save, and redeploy.
4. Print the codes on slips. A student types their code on the first screen.

For a class session you may want `SPROUT_GUEST=0`, so everything recorded belongs to class codes.

## Other settings (Environment tab)

| Variable | Default | Meaning |
|---|---|---|
| `SPROUT_AI_PER_DAY` | 30 | AI hints per code per day; after that the tutor gives its general advice |
| `SPROUT_COMPILE_PER_MIN` | 20 | code checks per network address per minute |
| `SPROUT_HINT_PER_MIN` | 10 | hint requests per network address per minute |
| `SPROUT_GROW_CONTACT` | (empty) | address or link shown to guests who say they are interested in Grow teams |
| `SPROUT_PHOTO_CHECK` | 1 | photo wiring check (needs AI hints on); `0` turns it off |
| `SPROUT_PHOTO_PER_DAY` | 15 | photo checks per code per day |
| `SPROUT_PHOTO_PER_MIN` | 20 | photo checks per network address per minute |
| `SPROUT_PHOTO_KEEP` | (off) | `1` stores each checked photo on the data disk; use only with consent |
| `SPROUT_GUESTS_PER_HOUR` | 10 | guest codes per network address per hour |
| `SPROUT_LLM_MODEL` | `claude-sonnet-5-5` | model for the AI hints; `claude-opus-5-5` is stronger and costs more |
| `SPROUT_ALLOWED_HOSTS` | (empty) | extra host names, e.g. a custom domain; the `onrender.com` name is automatic |

A whole classroom often shares one network address. For a class of 25 on campus Wi-Fi, raise
`SPROUT_COMPILE_PER_MIN` to about 150 and `SPROUT_HINT_PER_MIN` to about 60.

Compiles run one at a time (a few seconds each), so in a full class a check may wait in line for
up to about a minute at busy moments. That is fine for a pilot; a larger instance or a compile
queue comes later.

## Data on the server

Everything is under `/data` on the disk: `work/<code>/` (saved code, wiring, reflections),
`events/` (learning logs), `learners/` (progress), `guests.txt`, and `cache/` (AI replies).
No names are stored, only codes. To download it: **Shell** tab → `tar czf /tmp/data.tgz -C / data`,
or ask for a small export route if needed.

Before real students use the site, check with UCF (IT security review; IRB if the data will be
used in research). The site sends student code and questions to Anthropic for AI hints; turn that
off with `SPROUT_LLM_PROVIDER=mock` if it has not been approved.

## Running the same image elsewhere

```bash
docker build -t sprout-weblab .
docker run -p 8080:8080 -v sprout-data:/data -e SPROUT_GUEST=1 -e SPROUT_ALLOWED_HOSTS=example.org sprout-weblab
```

Put an HTTPS proxy (for example Caddy) in front: Web Serial only works on HTTPS pages.
