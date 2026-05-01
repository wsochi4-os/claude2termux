Installing the claude2t command globally (optional)

From the repository root on your server or development machine:

1. Install dependencies (once):
   npm install

2. Create a global symlink so `claude2t` is available anywhere:
   # You may need sudo depending on your system
   npm link

3. Verify:
   which claude2t
   claude2t status

Notes:
- `npm link` reads package.json `bin` and registers the binary globally. To uninstall, run `npm unlink -g <package-name>` or remove the symlink.
- Alternatively, call the command directly from the repo: ./claude2t start-daemon
