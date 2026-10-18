#!/usr/bin/env python3
"""Enroll a synthetic PIN through Settings on the owned disposable emulator.

Credential travels to the shell helper on stdin, never in argv or diagnostics.
No screenshot/video should run during credential enrollment.
"""
import json
import os
from pathlib import Path
import secrets
import sys
import time
from demo import LOCAL, PACKAGE, adb, assert_owned, click, tree, wait_for


def inject(serial, value):
    apk=adb(serial,'shell','pm','path',PACKAGE).strip().removeprefix('package:')
    if not apk.startswith('/data/app/') or not apk.endswith('/base.apk'): raise RuntimeError('Unexpected APK location')
    adb(serial,'shell',f'CLASSPATH={apk}','app_process','/system/bin',PACKAGE+'.ShellPin',input=value+b'\n')


def enroll():
    receipt=json.loads((LOCAL/'demo.json').read_text()); serial=receipt['serial']
    assert_owned(serial,receipt['avd'])
    path=LOCAL/f"pin-api{receipt['api']}.txt"
    marker=LOCAL/f"pin-api{receipt['api']}.ready"
    if marker.exists(): print('Synthetic credential already provisioned.'); return
    value=path.read_bytes() if path.exists() else (''.join(str(secrets.randbelow(10)) for _ in range(6))).encode()
    # Keep only in this ignored test fixture, with local-owner permissions.
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    os.fchmod(descriptor,0o600)
    with os.fdopen(descriptor,'wb') as file: file.write(value)
    try:
        adb(serial,'shell','am','start','-a','android.app.action.SET_NEW_PASSWORD')
        def choose_pin():
            if any(n.get('resource-id')=='com.android.settings:id/password_entry' for n in tree(serial).iter('node')): return True
            return click(serial,'PIN • Fingerprint • Face')
        wait_for(choose_pin,30,'PIN choice')
        wait_for(lambda:any(n.get('resource-id')=='com.android.settings:id/password_entry' for n in tree(serial).iter('node')),30,'credential entry')
        inject(serial,value)
        # Enter commonly advances the first screen; click Next only if it remains.
        time.sleep(.4)
        nodes=tree(serial)
        titles=' '.join(n.get('text','') for n in nodes.iter('node') if not n.get('password')=='true')
        if 'Set a PIN' in titles or 'Set a screen lock' in titles:
            click(serial,'NEXT'); time.sleep(.4)
        inject(serial,value)
        time.sleep(.4)
        click(serial,'CONFIRM')
        time.sleep(.4)
        # Biometric enrollment is optional; the fixture only needs its known PIN.
        for label in ['Skip','Not now','Done']:
            click(serial,label)
        adb(serial,'shell','input','keyevent','KEYCODE_HOME')
        adb(serial,'shell','am','start','-n',PACKAGE+'/.StationActivity')
        marker.write_text('Settings enrollment completed; verify secure keyguard in acceptance.\n')
        print('Synthetic emulator PIN enrolled; retained only in its private .local fixture.')
    except Exception:
        # Preserve a possible already-established credential for legitimate recovery.
        print('Enrollment incomplete; the private fixture credential was preserved for recovery.',file=sys.stderr)
        raise

def unlock_local():
    receipt=json.loads((LOCAL/'demo.json').read_text()); serial=receipt['serial']
    assert_owned(serial,receipt['avd'])
    trust=adb(serial,'shell','dumpsys','trust')
    if 'deviceLocked=1' not in trust: print('Emulator is already credential-unlocked.'); return
    path=LOCAL/f"pin-api{receipt['api']}.txt"
    if not path.exists(): raise RuntimeError('The owned emulator has no private fixture credential')
    boot=adb(serial,'shell','cat','/proc/sys/kernel/random/boot_id').strip()
    attempted=LOCAL/f"local-unlock-api{receipt['api']}.json"
    if attempted.exists() and json.loads(attempted.read_text()).get('boot')==boot:
        raise RuntimeError('Local unlock was already attempted this boot; refusing automatic replay')
    adb(serial,'shell','input','keyevent','KEYCODE_WAKEUP')
    adb(serial,'shell','input','keyevent','KEYCODE_MENU')
    time.sleep(.5)
    current=tree(serial)
    if not any(n.get('resource-id')=='com.android.systemui:id/pinEntry' for n in current.iter('node')):
        adb(serial,'shell','input','swipe','540','2000','540','600','400')
        time.sleep(.5)
        current=tree(serial)
    entry=next((n for n in current.iter('node') if n.get('resource-id')=='com.android.systemui:id/pinEntry'),None)
    if entry is None or entry.get('password')!='true' or entry.get('text')!='':
        raise RuntimeError('Local recovery requires an observed empty SystemUI PIN field')
    focus=adb(serial,'shell','dumpsys','window')
    if not any('NotificationShade' in line for line in focus.splitlines() if 'mCurrentFocus=' in line):
        raise RuntimeError('SystemUI must own keyboard focus')
    owners=adb(serial,'shell','dpm','list-owners')
    if 'no owners' not in owners.lower(): raise RuntimeError('Managed emulator recovery is excluded')
    attempted.write_text(json.dumps({'boot':boot})); attempted.chmod(0o600)
    inject(serial,path.read_bytes())
    wait_for(lambda:'deviceLocked=1' not in adb(serial,'shell','dumpsys','trust'),10,'first unlock effect')
    attempted.unlink(missing_ok=True)
    print('Owned emulator locally unlocked once using its private fixture credential.')

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='unlock': unlock_local()
    else: enroll()
