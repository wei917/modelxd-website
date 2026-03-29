import subprocess
import sys

def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True)
    if result.returncode != 0:
        print(f"❌ Failed: {result.stderr.decode().strip()}")
        sys.exit(1)

print("Merging dev → main...\n")

run("git checkout main")
run("git pull origin main")       # make sure main is up to date first
run("git merge dev")
run("git push origin main")
run("git checkout dev")           # switch back to dev

print("✅ Done! main is up to date and you're back on dev.")
