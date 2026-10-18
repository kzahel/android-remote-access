#!/usr/bin/env python3
"""Observe force-stop and reboot boundaries; do not claim automatic recovery."""
import json
import subprocess
import sys
import time
from client import Client
from demo import LOCAL, ROOT, PACKAGE, adb, assert_owned, wait_for

r=json.loads((LOCAL/'demo.json').read_text());serial=r['serial'];assert_owned(serial,r['avd'])
report={'api':r['api'],'checks':[]}

def check(name,value):
    report['checks'].append({'check':name,'pass':bool(value)})
    print(('PASS ' if value else 'FAIL ')+name,flush=True)
    if not value: raise AssertionError(name)

def rearm(): subprocess.run([sys.executable,str(ROOT/'scripts/demo.py'),'rearm'],check=True)

try:
    c=Client();check('Starts with an armed native connection',c.state()['connected'])
    adb(serial,'shell','am','force-stop',PACKAGE)
    wait_for(lambda:not c.state()['connected'],8,'process loss')
    time.sleep(2)
    check('Force-stop ends access and does not auto-rearm',not c.state()['connected'])
    rearm();check('Explicit local preparation restores access',c.state()['connected'])
    old=adb(serial,'shell','cat','/proc/sys/kernel/random/boot_id').strip()
    print('Rebooting only the owned emulator; observing first-unlock boundary.',flush=True)
    adb(serial,'reboot')
    wait_for(lambda:not c.state()['connected'],10,'reboot connection loss')
    wait_for(lambda:adb(serial,'shell','getprop','sys.boot_completed',timeout=5).strip()=='1',180,'reboot completion')
    assert_owned(serial,r['avd'])
    new=adb(serial,'shell','cat','/proc/sys/kernel/random/boot_id').strip()
    check('A real new boot generation was observed',new!=old)
    unlocked='RUNNING_UNLOCKED' in adb(serial,'shell','dumpsys','user')
    check('Credential-protected user storage starts locked',not unlocked)
    time.sleep(3)
    check('The ordinary app does not promise access before first unlock',not c.state()['connected'])
    # Explicit local testbed recovery using host-held synthetic data, not the app.
    subprocess.run([sys.executable,str(ROOT/'scripts/credential.py'),'unlock'],check=True)
    check('Host-assisted first unlock opens user storage','RUNNING_UNLOCKED' in adb(serial,'shell','dumpsys','user'))
    time.sleep(1)
    check('First unlock does not silently recreate the native grant',not c.state()['connected'])
    rearm()
    check('Explicit local preparation restores screen access after reboot',wait_for(lambda:c.call('/api/frame')['ok'],15,'post-reboot capture'))
    report['passed']=True
finally:
    filename=LOCAL/f"lifecycle-api{r['api']}.json";filename.write_text(json.dumps(report,indent=2));print('Private lifecycle result retained in .local.',flush=True)
