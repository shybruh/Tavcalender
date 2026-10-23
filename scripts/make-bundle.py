"""Builds the upload-ready deploy bundle: release/tavcal/ and release/tavcal.zip.

    python scripts/make-bundle.py

Production secrets are generated once into release/prod.env and reused on every
rebuild, so updates keep working with existing push subscriptions.
"""
import os
import secrets
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RELEASE = ROOT / "release"
OUT = RELEASE / "tavcal"
PROD_ENV = RELEASE / "prod.env"
SHELL = os.name == "nt"  # npm/npx are .cmd shims on Windows


def run(cmd, cwd):
    print("$", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True, shell=SHELL)


def add_missing(text):
    """Appends settings added in later versions, keeping existing values."""
    if "BOT_SECRET=" not in text:
        text = text.rstrip("\n") + f"\n# shared between the app and the Discord bot\nBOT_SECRET={secrets.token_hex(24)}\n"
    return text


def prod_env():
    if PROD_ENV.exists():
        text = add_missing(PROD_ENV.read_text(encoding="utf8"))
        PROD_ENV.write_text(text, encoding="utf8", newline="\n")
        return text
    out = subprocess.run(
        ["npx", "web-push", "generate-vapid-keys", "--json"],
        cwd=ROOT / "push", check=True, capture_output=True, text=True, shell=SHELL,
    ).stdout
    import json
    keys = json.loads(out)
    text = (
        "# Tav Calendar production settings. Keep private; keep the same across updates.\n"
        f"VAPID_PUBLIC_KEY={keys['publicKey']}\n"
        f"VAPID_PRIVATE_KEY={keys['privateKey']}\n"
        "# contact address push services can reach you at\n"
        "VAPID_SUBJECT=mailto:admin@example.com\n"
        f"PUSH_SECRET={secrets.token_hex(24)}\n"
        "# timezone for times in notification text, e.g. Europe/London\n"
        "TZ=UTC\n"
    )
    text = add_missing(text)
    RELEASE.mkdir(exist_ok=True)
    PROD_ENV.write_text(text, encoding="utf8")
    return text


def main():
    run(["npm", "run", "build"], ROOT / "web")

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "pocketbase").mkdir(parents=True)
    (OUT / "push").mkdir()
    (OUT / "discord").mkdir()

    shutil.copy(ROOT / "deploy" / "docker-compose.yml", OUT / "docker-compose.yml")
    shutil.copy(ROOT / "deploy" / "DEPLOY.md", OUT / "DEPLOY.md")
    shutil.copy(ROOT / "deploy" / "pocketbase.Dockerfile", OUT / "pocketbase" / "Dockerfile")
    shutil.copy(ROOT / "deploy" / "push.Dockerfile", OUT / "push" / "Dockerfile")
    shutil.copy(ROOT / "deploy" / "discord.Dockerfile", OUT / "discord" / "Dockerfile")
    for name in ["pb_migrations", "pb_hooks", "pb_public"]:
        shutil.copytree(ROOT / "backend" / name, OUT / "pocketbase" / name)
    for name in ["server.js", "package.json", "package-lock.json"]:
        shutil.copy(ROOT / "push" / name, OUT / "push" / name)
    shutil.copytree(ROOT / "discord" / "src", OUT / "discord" / "src")
    for name in ["package.json", "package-lock.json"]:
        shutil.copy(ROOT / "discord" / name, OUT / "discord" / name)
    (OUT / ".env").write_text(prod_env(), encoding="utf8", newline="\n")

    # make sure nothing dev-only slipped in
    assert not (OUT / "pocketbase" / "pb_data").exists()

    zip_path = RELEASE / "tavcal.zip"
    zip_path.unlink(missing_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(OUT.rglob("*")):
            if f.is_file():
                z.write(f, Path("tavcal") / f.relative_to(OUT))
    files = sum(1 for f in OUT.rglob("*") if f.is_file())
    print(f"\nbundle: {OUT}  ({files} files)\nzip:    {zip_path}  ({zip_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    sys.exit(main())
