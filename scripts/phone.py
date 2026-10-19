#!/usr/bin/env python3
"""Explicitly selected, USB-connected physical Android host demo.

Keeps an independent server/receipt; never changes lock or debugging settings.
The accessibility and screen-sharing prompts are accepted through visible UI.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import time

from demo import ROOT, LOCAL, ADB, PACKAGE, run, private, wait_for, build
from client import Client

STATE = LOCAL / 'phone'
STATE.mkdir(mode=0o700, exist_ok=True)
STATE.chmod(0o700)
RECEIPT = STATE / 'device.json'
# Optional owner-saved PIN: one line of digits, mode 0600. Read by the local server only.
SAVED_PIN = STATE / 'pin'
# The owned reverse mapping, which the server restores if an ADB route drops it.
LINK = STATE / 'link.json'


def receipt():
    return json.loads(RECEIPT.read_text())


def adb(*args, **kwargs):
    serial = receipt()['serial']
    if serial.startswith('emulator-'):
        raise RuntimeError('Physical phone required; use demo.py for an emulator')
    return run([ADB, '-s', serial, *args], **kwargs)


def write_link(data):
    if not data.get('hardwareSerial'):
        data['hardwareSerial']=adb('shell','getprop','ro.serialno').strip(); private(RECEIPT,data)
    private(LINK,{'serial':data['serial'],'hardwareSerial':data['hardwareSerial'],'devicePort':data['reversePort']})


def doctor():
    adapter = ROOT.parent / 'machine-control/platforms/android/bin/android-device'
    result = json.loads(subprocess.check_output([str(adapter), 'doctor', '--json'],
            env={**os.environ, 'ANDROID_TESTBED_SERIAL': receipt()['serial']}, timeout=30))
    private(STATE / 'doctor.json', result)
    if not result['ready'] or result['states']['interaction'] != 'unlocked':
        raise RuntimeError('Phone must already be unlocked and authorized; no credential is entered')
    if receipt().get('model') and adb('shell','getprop','ro.product.model').strip()!=receipt()['model']:
        raise RuntimeError('Selected phone identity changed')
    return result


def client():
    return Client(json.loads((STATE / 'running.json').read_text())['url'])


def nodes():
    apk = adb('shell', 'pm', 'path', PACKAGE).strip().removeprefix('package:')
    if not apk.startswith('/data/app/') or not apk.endswith('/base.apk') or '\n' in apk:
        raise RuntimeError('Unexpected fixture APK path')
    return json.loads(adb('shell', 'CLASSPATH='+apk, 'app_process', '/system/bin', PACKAGE+'.ShellUi'))['nodes']


def click(label):
    for n in nodes():
        if n.get('enabled') and label.casefold() in [n.get('text', '').casefold(), n.get('description', '').casefold()]:
            x,y,x2,y2=n['bounds']
            adb('shell','input','tap',str((x+x2)//2),str((y+y2)//2))
            return True
    return False


def start(args):
    if RECEIPT.exists():
        raise RuntimeError('Phone receipt exists; use rearm, or stop --restore before a fresh start')
    selector = json.loads(Path(args.selector_file).read_text())['serial']
    if not selector or selector.startswith('emulator-'):
        raise RuntimeError('An explicit physical-device selector file is required')
    private(RECEIPT, {'serial':selector})
    try:
        ready=doctor()
        if not args.no_build: build()
        installed=adb('shell','pm','path',PACKAGE,check=False).strip()
        if installed:
            raise RuntimeError('Spike package already installed without an owned receipt; preserving it')
        activities=adb('shell','dumpsys','activity','activities')
        previous=re.search(r'(?:mResumedActivity|topResumedActivity).*?\su\d+\s+([A-Za-z0-9_.]+/[A-Za-z0-9_.$]+)',activities)
        data=receipt()
        data.update(api=ready['extensions']['apiLevel'],
            previous=previous.group(1) if previous else None,
            originalServices=adb('shell','settings','get','secure','enabled_accessibility_services').strip(),
            originalAccessibility=adb('shell','settings','get','secure','accessibility_enabled').strip(),
            model=adb('shell','getprop','ro.product.model').strip(), installedByUs=False)
        private(RECEIPT,data)
        data['installAttempted']=True;private(RECEIPT,data)
        adb('install',str(ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'),timeout=90)
        data['installedByUs']=True; private(RECEIPT,data)
        barrier=adb('shell','am','wait-for-broadcast-idle',timeout=30)
        if 'All broadcast queues are idle' not in barrier: raise RuntimeError('Package broadcasts still pending')
        config={'port':args.port,'phonePort':0,'token':secrets.token_urlsafe(32),
                'profile':'usb-phone','deviceName':data['model'],'adb':str(ADB),
                'phoneUnlock':True,'savedPinFile':str(SAVED_PIN),'linkFile':str(LINK)}
        private(STATE/'server.json',config)
        with (STATE/'server.log').open('w') as log:
            proc=subprocess.Popen(['node',str(ROOT/'server.mjs')],cwd=ROOT,
                env={**os.environ,'DEMO_CONFIG':str(STATE/'server.json'),'DEMO_RUNNING':str(STATE/'running.json')},
                stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        data['serverPid']=proc.pid;private(RECEIPT,data)
        running=wait_for(lambda:json.loads((STATE/'running.json').read_text()) if (STATE/'running.json').exists()
            and json.loads((STATE/'running.json').read_text()).get('pid')==proc.pid else None,15,'phone demo server')
        # tcp:0 allocates a new device-side port without replacing any mapping.
        port=adb('reverse','tcp:0','tcp:'+str(running['phonePort'])).strip()
        if not port.isdigit(): raise RuntimeError('ADB did not allocate a fresh reverse port')
        data.update(reversePort=int(port),nativePort=running['phonePort'],url=running['url'])
        private(RECEIPT,data); write_link(data)
        adb('shell','run-as',PACKAGE,'mkdir','-p','files')
        adb('shell',f"run-as {PACKAGE} sh -c 'cat > files/pairing.json'",input=json.dumps({
            'host':'127.0.0.1','port':int(port),'token':config['token']}).encode())
        adb('shell','am','start','-n',PACKAGE+'/.SetupActivity')
        print('Phone app installed and paired. Accept local permissions, then Start remote access.')
        print('Browser: '+running['url'])
    except Exception:
        # Preserve recovery information if deployment was attempted, including
        # an uncertain install result. Cleanup remains explicit and reversible.
        if 'originalServices' not in receipt(): RECEIPT.unlink(missing_ok=True)
        raise


def allow(args):
    doctor()
    adb('shell','am','start','-n',PACKAGE+'/.SetupActivity','--activity-clear-top')
    # Notification permission is a visible, optional Android prompt.
    labels=[n.get('text','').casefold() for n in nodes()]
    if any('remote access spike' in label and 'notification' in label for label in labels):
        click('Allow')
    if not client().state()['connected']:
        services=adb('shell','settings','get','secure','enabled_accessibility_services')
        if PACKAGE not in services:
            wait_for(lambda:click('1 · Allow screen access'),10,'screen access setup')
            wait_for(lambda:click('Remote access spike'),10,'accessibility service entry')
            wait_for(lambda:click('Use Remote access spike'),10,'accessibility permission switch')
            wait_for(lambda:click('Allow'),10,'visible accessibility permission consent')
            adb('shell','am','start','-n',PACKAGE+'/.SetupActivity','--activity-clear-top')
        wait_for(lambda:click('2 · Start remote access'),10,'local Start button')
        wait_for(lambda:client().state()['connected'],15,'native phone connection')
    wait_for(lambda:client().call('/api/frame').get('ok'),15,'native phone screenshot')
    print('Native phone screen and input connected: '+receipt()['url'])


def smooth(args):
    doctor()
    if not client().state()['connected']: raise RuntimeError('Use allow or rearm first')
    adb('shell','am','start','-n',PACKAGE+'/.SetupActivity','--activity-clear-top')
    wait_for(lambda:click('Allow smooth screen sharing'),10,'local screen-sharing button')
    def consent():
        labels=[n.get('text','') for n in nodes()]
        if not any('screen' in label.lower() for label in labels): return False
        return any(click(label) for label in ['Start now','Start','Share screen'])
    wait_for(consent,15,'visible Android screen-sharing consent')
    wait_for(lambda:client().state()['state'].get('video',{}).get('active'),15,'phone video encoder')
    client().action('openTouchLab')
    print('Consented phone video ready: '+receipt()['url'])


def rearm(args):
    if receipt().get('stopped'):
        raise RuntimeError('Server stopped; use stop --restore, then start a fresh demo')
    doctor()
    if args.restart_server:
        data=receipt()
        command=run(['ps','-p',str(data['serverPid']),'-o','command='],check=False)
        if str(ROOT/'server.mjs') not in command: raise RuntimeError('Phone server identity changed')
        os.kill(data['serverPid'],signal.SIGTERM)
        wait_for(lambda:not run(['ps','-p',str(data['serverPid']),'-o','command='],check=False).strip(),10,'old server exit')
        config=json.loads((STATE/'server.json').read_text())
        write_link(data)
        config.update(phonePort=data['nativePort'],phoneUnlock=True,savedPinFile=str(SAVED_PIN),linkFile=str(LINK))
        private(STATE/'server.json',config)
        with (STATE/'server.log').open('w') as log:
            proc=subprocess.Popen(['node',str(ROOT/'server.mjs')],cwd=ROOT,
                env={**os.environ,'DEMO_CONFIG':str(STATE/'server.json'),'DEMO_RUNNING':str(STATE/'running.json')},
                stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        data['serverPid']=proc.pid;private(RECEIPT,data)
        wait_for(lambda:json.loads((STATE/'running.json').read_text()).get('pid')==proc.pid,15,'new phone server')
    # Re-assert the owned mapping: a dropped ADB route may have removed it.
    data=receipt(); write_link(data)
    adb('reverse','tcp:'+str(data['reversePort']),'tcp:'+str(data['nativePort']))
    if args.install:
        adb('install','-r',str(ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'),timeout=90)
        barrier=adb('shell','am','wait-for-broadcast-idle',timeout=30)
        if 'All broadcast queues are idle' not in barrier: raise RuntimeError('Package broadcasts still pending')
    adb('shell','am','start','-n',PACKAGE+'/.SetupActivity','--activity-clear-top')
    wait_for(lambda:click('2 · Start remote access'),10,'local Start button')
    wait_for(lambda:client().state()['connected'],15,'native phone connection')
    print('Phone access re-armed locally: '+receipt()['url'])


def unlock(args):
    # doctor() requires an unlocked phone, so check identity directly.
    if receipt().get('stopped'): raise RuntimeError('Server stopped; rearm first')
    if adb('shell','getprop','ro.product.model').strip()!=receipt()['model']:
        raise RuntimeError('Selected phone identity changed')
    c=client(); s=c.state()
    if not s['connected']: raise RuntimeError('Phone app is not connected; rearm first')
    if not s['state'].get('locked'): print('Phone is already unlocked.'); return
    if s['unlockBlocked']: raise RuntimeError('An attempt was already made; unlock locally first')
    if args.saved:
        if not SAVED_PIN.exists(): raise RuntimeError(f'No saved PIN at {SAVED_PIN}')
        secret={'useTestPin':True}
    else:
        secret={'pin':getpass.getpass('Phone PIN (hidden, one attempt): ')}
    c.action('wake'); c.action('dismiss')
    time.sleep(1.5)
    try: result=c.action('unlock',**secret)
    finally: secret.clear()
    print(result['message'])
    if not result['ok'] or result.get('data',{}).get('locked'): sys.exit(1)


def stop(args):
    data=receipt()
    try: client().action('stop')
    except Exception: pass
    adb('shell','am','force-stop',PACKAGE)
    if data.get('reversePort'):
        mapping=adb('reverse','--list')
        expected=['tcp:'+str(data['reversePort']),'tcp:'+str(data['nativePort'])]
        if any(line.split()[-2:]==expected for line in mapping.splitlines()):
            adb('reverse','--remove',expected[0])
    if data.get('serverPid'):
        command=run(['ps','-p',str(data['serverPid']),'-o','command='],check=False)
        if str(ROOT/'server.mjs') in command: os.kill(data['serverPid'],signal.SIGTERM)
    if args.restore:
        if data.get('installedByUs') or data.get('installAttempted'):
            if adb('shell','pm','path',PACKAGE,check=False).strip(): adb('uninstall',PACKAGE)
        # Uninstall only removes this service; Android retains the other grants.
        if data.get('previous'): adb('shell','am','start','-n',data['previous'])
    private(STATE/'last-device.json',data)
    if args.restore: RECEIPT.unlink()
    else:
        data['stopped']=True;private(RECEIPT,data)
    (STATE/'running.json').unlink(missing_ok=True)
    print('Phone demo stopped; owned reverse removed.'+(' Test app removed and previous app restored.' if args.restore else ' Test app remains installed.'))


def main():
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='command',required=True)
    s=sub.add_parser('start');s.add_argument('--selector-file',required=True);s.add_argument('--port',type=int,default=4318);s.add_argument('--no-build',action='store_true')
    for name in ['allow','smooth']:sub.add_parser(name)
    s=sub.add_parser('rearm');s.add_argument('--restart-server',action='store_true');s.add_argument('--install',action='store_true',help='replace the app with the current debug APK first')
    s=sub.add_parser('unlock');s.add_argument('--saved',action='store_true',help=f'use the PIN saved in {SAVED_PIN}')
    s=sub.add_parser('stop');s.add_argument('--restore',action='store_true')
    args=p.parse_args()
    try: globals()[args.command](args)
    except Exception as e: print(str(e),file=sys.stderr);sys.exit(1)

if __name__=='__main__':main()
