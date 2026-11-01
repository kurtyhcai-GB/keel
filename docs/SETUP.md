# Set up Keel (first time)

This guide is for people who have never used a terminal, Git, or Node. You will copy and paste commands. You do not need to understand them yet.

Keel is a job-search app you run on your own computer. You upload a resume, say what kind of role you want, and Keel scores job postings against that record. Your files stay on your computer.

## What you need

- A computer running **Windows 10 or 11**, or a **Mac** (macOS).
- About **20 to 30 minutes**.
- A free **Google account**, so you can get a free AI key. Keel can start without one, but extraction and scoring are much more limited until you add a key.
- An internet connection for the download and for AI calls.

Keel does **not** run on an iPhone or iPad. It also does not run in a phone browser as an app you install. Use a Windows PC or a Mac.

## 1. Open a terminal

A terminal is a text window where you type commands and the computer answers with text. You will paste commands into it. Leave the window open while Keel is running.

### Windows

1. Click the **Start** button.
2. Type `PowerShell`.
3. Click **Windows PowerShell** (or **PowerShell**). A blue or black window opens. That is your terminal.

To paste: click inside the window, then press **Ctrl+V**. You can also right-click.

### Mac

1. Press **Cmd+Space**. That opens Spotlight.
2. Type `Terminal`.
3. Press **Return**. A window opens. That is your terminal.

To paste: click inside the window, then press **Cmd+V**.

## 2. Install Git

Git is the tool that downloads Keel.

### Windows

1. Open [https://git-scm.com/download/win](https://git-scm.com/download/win) in your browser.
2. The download should start. If it does not, click the link for **64-bit Git for Windows Setup**.
3. Open the downloaded file and click through the installer. The default options are fine. Keep clicking **Next**, then **Install**.
4. **Close PowerShell completely**, then open it again (Start, type PowerShell). Git is not visible in a window that was already open.

### Mac

1. In Terminal, paste this and press **Return**:

```bash
xcode-select --install
```

2. A window asks to install command line developer tools. Click **Install**, then wait. It can take several minutes. If it says the tools are already installed, that is fine.
3. If that command fails, install Git from [https://git-scm.com/download/mac](https://git-scm.com/download/mac) instead, then close Terminal and open it again.

### Check (Windows and Mac)

Paste this and press **Enter** (Windows) or **Return** (Mac):

```bash
git --version
```

**What you should see:** a line like `git version 2.45.0` (the numbers can differ). If you see “not recognized” or “command not found”, close the terminal, open a new one, and try again. See [Troubleshooting](#troubleshooting).

## 3. Install Node.js

Node.js is the program that runs Keel. You also get **npm**, which installs Keel’s pieces. Keel needs **Node.js 22**. On [https://nodejs.org](https://nodejs.org), use the button labeled **LTS** when it is version 22 (or newer). Do not pick a version that starts with 18 or 20.

### Windows

1. Open [https://nodejs.org](https://nodejs.org).
2. Download the **Windows Installer (.msi)** for the LTS release (64-bit).
3. Open the file and click through the installer. Leave the default options, including the one that adds Node to PATH.
4. **Close PowerShell and open it again.**

### Mac

1. Open [https://nodejs.org](https://nodejs.org).
2. Download the **macOS Installer (.pkg)** for the LTS release.
3. Open the file and click through the installer.
4. **Close Terminal and open it again** (Cmd+Space, type Terminal).

### Check (Windows and Mac)

```bash
node -v
```

```bash
npm -v
```

**What you should see:** `node` prints something like `v22.20.0`. `npm` prints a number like `10.9.0`. Your numbers can be a little different. The Node number should start with `v22` (or higher).

### Windows only: if npm says scripts are disabled

If PowerShell says npm cannot run because **running scripts is disabled**, paste this, press Enter, and type `Y` when it asks:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then try `npm -v` again.

## 4. Download Keel

Keel goes in your **home folder**. That is the folder named after you.

- Windows example: `C:\Users\Alex\keel`
- Mac example: `/Users/Alex/keel`

The commands below use `~`, which means “my home folder”, so you do not type your name.

Paste these one at a time. Wait until each one finishes before you paste the next.

```bash
cd ~
```

```bash
git clone https://github.com/kurtyhcai-GB/keel.git
```

```bash
cd keel
```

**What you should see:** `git clone` prints “Cloning into 'keel'...” and then finishes with no error. `cd keel` prints nothing. That is normal. You are now inside the Keel folder.

## 5. Install Keel’s pieces and create the database

Still in the same terminal, and still inside the `keel` folder:

```bash
npm install
```

This can take a few minutes. Lines that say **warn** or **deprecated** are normal. Wait until you get your cursor back and there is no red `ERR!` at the end.

**What you should see:** a tree of package names, then something like `added 400 packages`. The last lines often say Prisma generated a client. That is expected. `npm install` already runs that generate step.

Then set up the local database. Paste these one at a time:

```bash
npx prisma generate
```

```bash
npx prisma db push
```

**What you should see:** `generate` says it generated Prisma Client. `db push` says the database is in sync (or that it created the SQLite database). The file is `data/keel.sqlite` inside the Keel folder. Starting the app later also creates this file if it is missing, but run both commands now so the first start is simpler.

## 6. Get a free Google AI key

Keel can run with no key, in a limited local mode. It will not read a normal resume well. A free Google key lets it extract roles and score postings.

1. In your browser, open [https://aistudio.google.com](https://aistudio.google.com).
2. Sign in with your Google account.
3. Choose **Get API key**, then **Create API key**.
4. Copy the key. It is a long string of letters and numbers.

Treat the key like a password. Do not email it, post it, or put it in GitHub. Each person uses their own key. This guide never asks you to send the key to anyone else.

## 7. Create the `.env` file

A `.env` file is a private settings file on your computer. Keel reads it when it starts. It is not uploaded when you update Keel.

You must be inside the `keel` folder (`cd ~/keel` on Mac, or `cd $HOME\keel` on Windows, if you closed the terminal).

### Windows

```powershell
copy .env.example .env
```

```powershell
notepad .env
```

### Mac

```bash
cp .env.example .env
```

```bash
open -e .env
```

Notepad or TextEdit opens. Find these lines and set them like this (paste your real key after the `=` with no spaces and no quotes):

```text
AI_PROVIDER=google
GOOGLE_API_KEY=your-key
GOOGLE_MODEL=gemini-3.6-flash
```

The example file ships with `AI_PROVIDER=local` and `GOOGLE_MODEL=gemini-3.7-flash`. Change both so they match the three lines above. `gemini-3.6-flash` is the free-tier model this guide uses.

Save the file and close the editor.

- Windows Notepad: **File → Save**, then close.
- Mac TextEdit: **Cmd+S**, then close.

### Free-tier limits

On the free tier, `gemini-3.6-flash` allows about **5 requests per minute** and about **20 requests per day**. Those numbers are Google’s limits, not Keel’s, and Google can change them.

- If you see **429** or the word **quota**, you hit that limit. Wait a minute and try again, or wait until the next day. You can also pick another model name from the rate-limit page in Google AI Studio and put that name in `GOOGLE_MODEL`.
- If you see **503**, Google’s servers are busy. Nothing is wrong with your install. Try again later.

### Other providers, and no key at all

`.env.example` also supports these providers. You only need Google for this guide.

| Provider | What to set |
| --- | --- |
| OpenAI | `AI_PROVIDER=openai`, plus `OPENAI_API_KEY` and `OPENAI_MODEL` (example default `gpt-4o-mini`) |
| Anthropic | `AI_PROVIDER=anthropic`, plus `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` (example default `claude-sonnet-4-5`) |
| OpenAI-compatible (Ollama, LM Studio, and similar) | `AI_PROVIDER=openai-compatible`, plus `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` (can be empty), and `OPENAI_COMPATIBLE_MODEL` |
| Local only | `AI_PROVIDER=local` or delete the `.env` file |

Without a key, leave `AI_PROVIDER=local`. Keel then stays in a limited local mode: it does not send your text to an AI company, and it only understands a resume if you type it in a special `ROLE:` / `COMPANY:` format (see the README). A normal PDF will be stored, and Keel will say that no roles were extracted.

## 8. Start Keel

In the terminal, inside the `keel` folder:

```bash
npm run dev
```

The terminal will look stuck. Text stops moving, and you do not get a new prompt. That is normal. Keel is running. **Leave this window open.**

**What you should see:** a line that says the app is ready, and a local address:

[http://localhost:4317](http://localhost:4317)

Open that address in your browser (Chrome, Edge, Firefox, or Safari). You should see Keel. The first screen is mostly empty until you add a resume.

To stop Keel: click the terminal window and press **Ctrl+C**. On a Mac that is still the Control key, not Cmd. You can close the browser tab first.

## 9. Use Keel next time

You do not install it again.

1. Open PowerShell (Windows) or Terminal (Mac).
2. Go to the Keel folder.

Windows:

```powershell
cd $HOME\keel
```

Mac:

```bash
cd ~/keel
```

3. Start it:

```bash
npm run dev
```

4. Open [http://localhost:4317](http://localhost:4317).
5. Press **Ctrl+C** in the terminal when you are done.

## 10. Update to the newest version

Stop Keel first (**Ctrl+C**). Then, inside the `keel` folder:

```bash
git pull
```

```bash
npm install
```

```bash
npx prisma generate
```

```bash
npx prisma db push
```

Then `npm run dev` again.

**Known issue:** if `git pull` says `package-lock.json` has local changes, run this, then pull again:

```bash
git checkout -- package-lock.json
```

```bash
git pull
```

Then continue with `npm install` and the two `npx prisma` commands.

## Troubleshooting

### ‘git’, ‘node’, or ‘npm’ is not recognized

- Close the terminal and open a new one. Installers only update new windows.
- Run `git --version`, `node -v`, and `npm -v` again.
- On Windows, if it still fails, run the Git or Node installer again and leave “Add to PATH” checked. Then open a new PowerShell.
- On Mac, if `git` fails, run `xcode-select --install` again.

### Port already in use

Something else is using port **4317**, often a Keel window you already started. Find the other terminal and press **Ctrl+C**, or restart the computer, then run `npm run dev` again.

### “No roles were extracted”

The file was saved, but the AI step did not run. Check `.env`: `AI_PROVIDER=google` and `GOOGLE_API_KEY` is your real key, with no extra spaces. Save the file, stop Keel with **Ctrl+C**, start it again with `npm run dev`, and use **Extract** again.

### 429 or quota

You hit Google’s free-tier limit (about 5 requests per minute and 20 per day for `gemini-3.6-flash`). Wait, or switch `GOOGLE_MODEL` to another model listed on your AI Studio rate-limit page, then restart Keel.

### 503

Google’s servers are busy. Try again later.

### Where your data lives

Everything you type stays in the `keel` folder on your computer:

- `data/keel.sqlite` is the database (resume facts, jobs, letters).
- `data/uploads/` holds uploaded files.

Keel does not upload that folder. The only text that leaves your computer is what a single AI call sends to the provider you configured (your baseline and the job text). With `AI_PROVIDER=local` and no key, even that is not sent.

### Back up

Copy the whole `data` folder somewhere safe (a USB drive or another folder). That copy is your backup.

### Reset the database

Stop Keel (**Ctrl+C**). This deletes your saved resume, jobs, and letters.

Windows:

```powershell
del data\keel.sqlite
```

Mac:

```bash
rm data/keel.sqlite
```

Then create an empty database again:

```bash
npx prisma db push
```

Start Keel with `npm run dev`. Uploaded files in `data/uploads/` are still there. Delete that folder too if you want those gone.

## Optional: Docker

If you already use Docker, this is another way to start Keel. Skip this if you followed the steps above.

```bash
docker compose up --build
```

The app listens on port 4317. The `data` folder is kept across rebuilds. Put API keys in `.env` next to `docker-compose.yml` if you want a provider. Without them, Keel uses the limited local mode.
