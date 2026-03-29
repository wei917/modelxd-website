#!/usr/bin/env python3
import os
import sys
import time
import zipfile
import subprocess
from pathlib import Path

DOWNLOADS_DIR = Path("/Users/cwei/Downloads")
DEST_DIR = Path("/Users/cwei/Documents/Projects/modelxd-website")


def latest_zip_file(folder: Path) -> Path:
    zips = [p for p in folder.glob("*.zip") if p.name.startswith("model")]
    if not zips:
        raise FileNotFoundError(f"No .zip files starting with 'model' found in {folder}")
    return max(zips, key=lambda p: p.stat().st_mtime)


def detect_single_top_folder(zipf: zipfile.ZipFile) -> str | None:
    """If all non-dir entries live under one top-level folder, return it; else None."""
    top_levels = set()
    for name in zipf.namelist():
        if not name or name.endswith("/"):
            continue
        parts = name.split("/")
        if not parts or parts[0] == "":
            return None
        top_levels.add(parts[0])
        if len(top_levels) > 1:
            return None
    return next(iter(top_levels)) if top_levels else None


def ensure_within_dest(dest: Path, rel: Path) -> Path:
    """Prevent zip-slip by ensuring final path stays inside dest."""
    out_path = (dest / rel).resolve()
    dest_resolved = dest.resolve()
    if out_path == dest_resolved:
        return out_path
    if not str(out_path).startswith(str(dest_resolved) + os.sep):
        raise RuntimeError(f"Blocked path traversal attempt: {rel}")
    return out_path


def unzip_overwrite_flatten(zip_path: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    print(f"Latest zip: {zip_path}")

    with zipfile.ZipFile(zip_path, "r") as zipf:
        top_folder = detect_single_top_folder(zipf)
        if top_folder:
            print(f"Flattening single top folder: {top_folder}/")
        else:
            print("Extracting as-is (no single top folder to flatten).")

        for info in zipf.infolist():
            name = info.filename
            if not name:
                continue

            rel = Path(name)

            # Flatten if there's exactly one top folder
            if top_folder:
                parts = rel.parts
                if parts and parts[0] == top_folder:
                    rel = Path(*parts[1:])

            # Skip entries that become empty after flattening
            if str(rel) in ("", "."):
                continue

            out_path = ensure_within_dest(dest, rel)

            if info.is_dir() or name.endswith("/"):
                out_path.mkdir(parents=True, exist_ok=True)
                continue

            out_path.parent.mkdir(parents=True, exist_ok=True)

            # OVERWRITE
            with zipf.open(info, "r") as src, open(out_path, "wb") as dst:
                dst.write(src.read())

    print(f"Done unzipping into: {dest} (overwritten where applicable)")


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd), text=True, capture_output=True)


def ensure_git_repo(dest: Path) -> None:
    res = run(["git", "rev-parse", "--is-inside-work-tree"], cwd=dest)
    if res.returncode != 0 or res.stdout.strip() != "true":
        raise RuntimeError(f"{dest} is not a git repo (or git not available).\n{res.stderr.strip()}")


def git_commit_and_push(dest: Path, message: str) -> bool:
    """
    Returns True if a commit+push happened, False if there were no changes.
    Raises on error.
    """
    ensure_git_repo(dest)

    res = run(["git", "add", "-A"], cwd=dest)
    if res.returncode != 0:
        raise RuntimeError(f"git add failed:\n{res.stderr.strip()}")

    res = run(["git", "status", "--porcelain"], cwd=dest)
    if res.returncode != 0:
        raise RuntimeError(f"git status failed:\n{res.stderr.strip()}")

    if res.stdout.strip() == "":
        print("No changes detected. Skipping commit & push.")
        return False

    res = run(["git", "commit", "-m", message], cwd=dest)
    if res.returncode != 0:
        raise RuntimeError(f"git commit failed:\n{res.stderr.strip()}\n{res.stdout.strip()}")
    print(res.stdout.strip())

    res = run(["git", "push"], cwd=dest)
    if res.returncode != 0:
        raise RuntimeError(f"git push failed:\n{res.stderr.strip()}\n{res.stdout.strip()}")
    print(res.stdout.strip() or "Pushed successfully.")

    return True


def delete_zip(zip_path: Path) -> None:
    try:
        zip_path.unlink()
        print(f"Deleted zip: {zip_path}")
    except FileNotFoundError:
        print(f"Zip already missing: {zip_path}")
    except PermissionError as e:
        raise RuntimeError(f"Permission denied deleting zip: {zip_path}") from e


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: python3 unzip_and_push.py "your commit message"')
        return 2

    commit_msg = sys.argv[1].strip()
    if not commit_msg:
        print("Error: commit message must be non-empty.")
        return 2

    zip_path = latest_zip_file(DOWNLOADS_DIR)
    unzip_overwrite_flatten(zip_path, DEST_DIR)

    time.sleep(1)

    did_push = git_commit_and_push(DEST_DIR, commit_msg)

    # Delete zip only if we actually committed & pushed.
    if did_push:
        delete_zip(zip_path)
    else:
        print("Skipped deleting zip because there was nothing to commit/push.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())