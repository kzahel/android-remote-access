#!/usr/bin/env python3
"""Own one isolated emulator and local demo. Never select a physical device."""
import argparse
import glob
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import shlex
import signal
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
LOCAL.mkdir(mode=0o700,exist_ok=True)
LOCAL.chmod(0o700)
PACKAGE = 'dev.remoteaccess.spike'
SDK = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or next((str(p) for p in [Path.home()/'Android/Sdk',Path.home()/'Library/Android/sdk'] if p.exists()), ''))
ADB = SDK / 'platform-tools/adb'
EMULATOR = SDK / 'emulator/emulator'


def run(args, *, input=None, timeout=30, check=True):
    return subprocess.run([str(v) for v in args], input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=check).stdout.decode()


def adb(serial, *args, **kwargs):
    if not serial.startswith('emulator-'):
        raise RuntimeError('This runner only controls its isolated emulator')
    return run([ADB, '-s', serial, *args], **kwargs)


def private(path, value):
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    os.fchmod(descriptor,0o600)
    with os.fdopen(descriptor,'w') as file: json.dump(value,file)


def wait_for(fn, seconds=120, description='condition'):
    until = time.monotonic()+seconds
    while time.monotonic()<until:
        try:
            value=fn()
            if value: return value
        except (Exception, subprocess.TimeoutExpired): pass
        time.sleep(.5)
    raise RuntimeError(f'Timed out waiting for {description}')


def build():
    gradle = os.environ.get('GRADLE_BIN') or shutil.which('gradle')
    if not gradle:
        candidates=glob.glob(str(Path.home()/'.gradle/wrapper/dists/gradle-8.13-bin/*/gradle-8.13/bin/gradle'))
        if candidates: gradle=candidates[0]
    if not gradle: raise RuntimeError('Install Gradle 8.13 or set GRADLE_BIN')
    env={**os.environ,'ANDROID_HOME':str(SDK)}
    with (LOCAL/'android-build.log').open('w') as log:
        result=subprocess.run([gradle,'-p',str(ROOT/'android'),':app:assembleDebug',':app:lint'],env=env,stdout=log,stderr=subprocess.STDOUT)
    if result.returncode: raise RuntimeError('Android build failed; see .local/android-build.log')


def tree(serial):
    apk=adb(serial,'shell','pm','path',PACKAGE).strip().removeprefix('package:')
    if not apk.startswith('/data/app/') or not apk.endswith('/base.apk'): raise RuntimeError('Unexpected fixture APK location')
    snapshot=json.loads(adb(serial,'shell',f'CLASSPATH={apk}','app_process','/system/bin',PACKAGE+'.ShellUi'))
    root=ET.Element('hierarchy')
    for node in snapshot['nodes']:
        a,b,c,d=node['bounds']
        ET.SubElement(root,'node',{'text':node.get('text',''),'content-desc':node.get('description',''),
            'resource-id':node.get('id',''),'password':str(node.get('password',False)).lower(),
            'password-has-text':str(node.get('hasText',False)).lower(),
            'enabled':str(node.get('enabled',False)).lower(),'bounds':f'[{a},{b}][{c},{d}]'})
    return root


def click(serial, text=None, resource=None, contains=False):
    nodes=tree(serial)
    for n in nodes.iter('node'):
        value=n.get('text','') or n.get('content-desc','')
        match=(resource and n.get('resource-id')==resource) or (text and (text.lower() in value.lower() if contains else value.lower()==text.lower()))
        if match and n.get('enabled')!='false':
            import re
            a,b,c,d=map(int,re.findall(r'\d+',n.get('bounds')))
            adb(serial,'shell','input','tap',str((a+c)//2),str((b+d)//2)); return True
    return False


def assert_owned(serial, avd=None):
    if adb(serial,'shell','getprop','ro.kernel.qemu').strip()!='1': raise RuntimeError('Not an emulator')
    if avd and adb(serial,'emu','avd','name').splitlines()[0].strip()!=avd: raise RuntimeError('Wrong AVD identity')


def provision(serial, pairing):
    assert_owned(serial)
    services=adb(serial,'shell','settings','get','secure','enabled_accessibility_services').strip()
    enabled=[] if services in ('','null') else services.split(':')
    # APK replacement can leave a stale accessibility connection on Android 16.
    # Renew only this fixture's permission, preserving all other enabled services.
    remaining=[service for service in enabled if service.split('/')[0]!=PACKAGE]
    adb(serial,'shell',f"settings put secure enabled_accessibility_services {shlex.quote(':'.join(remaining))}")
    def fixture_unbound():
        dump=adb(serial,'shell','dumpsys','accessibility')
        return not any(
            ('Remote access spike' in line if 'Bound services:' in line else PACKAGE in line)
            for line in dump.splitlines()
            if any(section in line for section in ['Bound services:','Binding services:','Crashed services:','Enabled services:'])
        )
    # Settings writes return before AccessibilityManager has removed the old
    # binder. Installing/re-enabling in that gap can bind a stale service on 36.
    wait_for(fixture_unbound,10,'old fixture accessibility connection to unbind')
    # Framework unbinding and the Java service's teardown are asynchronous.
    # Reap only our disposable fixture process before APK replacement so a
    # late onUnbind/onDestroy cannot overlap the next local access grant.
    adb(serial,'shell','am','force-stop',PACKAGE)
    wait_for(lambda:not adb(serial,'shell','pidof',PACKAGE,check=False).strip(),10,'old fixture process to exit')
    apk=ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'
    installed=adb(serial,'shell','pm','path',PACKAGE,check=False).strip().removeprefix('package:')
    same_apk=False
    if installed.startswith('/data/app/') and installed.endswith('/base.apk') and '\n' not in installed:
        digest=adb(serial,'shell','sha256sum',installed,check=False).split()
        same_apk=bool(digest) and digest[0]==hashlib.sha256(apk.read_bytes()).hexdigest()
    if not same_apk:
        adb(serial,'install','-r',str(apk),timeout=90)
    # Package replacement broadcasts can outlive `adb install` and revoke a
    # newly rebound accessibility connection. Drain them before enabling it.
    barrier=adb(serial,'shell','am','wait-for-broadcast-idle',timeout=30)
    if 'All broadcast queues are idle' not in barrier:
        raise RuntimeError('Package changes have not settled; accessibility was left disabled')
    adb(serial,'shell','run-as',PACKAGE,'mkdir','-p','files')
    adb(serial,'shell',f"run-as {PACKAGE} sh -c 'cat > files/pairing.json'",input=json.dumps(pairing).encode())
    adb(serial,'shell','pm','grant',PACKAGE,'android.permission.POST_NOTIFICATIONS')
    # This is an explicitly disposable AVD. No existing shared profile is used.
    services=adb(serial,'shell','settings','get','secure','enabled_accessibility_services').strip()
    service=PACKAGE+'/.AccessService'
    enabled=[] if services in ('','null') else services.split(':')
    if service not in enabled: enabled.append(service)
    adb(serial,'shell','settings','put','secure','enabled_accessibility_services',':'.join(enabled))
    adb(serial,'shell','settings','put','secure','accessibility_enabled','1')
    adb(serial,'shell','input','keyevent','KEYCODE_WAKEUP')
    adb(serial,'shell','wm','dismiss-keyguard')
    now=int(adb(serial,'shell','date','+%s').strip())*1000
    adb(serial,'shell',f"run-as {PACKAGE} sh -c 'cat > files/start-request.json'",input=json.dumps({'createdAtMillis':now}).encode())
    adb(serial,'shell','am','start','-n',PACKAGE+'/.SetupActivity','--activity-clear-top')
    from client import Client
    client=Client()
    wait_for(lambda:client.state()['connected'],15,'native access grant')
    capture_status={}
    def verified_capture():
        result=client.call('/api/frame')
        capture_status.update(ok=result.get('ok'),message=result.get('message'))
        return result.get('ok')
    try:
        wait_for(verified_capture,15,'verified native screen capture')
    except RuntimeError:
        private(LOCAL/'provision-capture-failure.json',capture_status)
        (LOCAL/'provision-accessibility.txt').write_text(adb(serial,'shell','dumpsys','accessibility'))
        raise RuntimeError('Native screen capture did not become ready: '+str(capture_status.get('message','no response'))) from None


def start(args):
    state_path=LOCAL/'demo.json'
    if state_path.exists(): raise RuntimeError('A demo receipt exists. Run npm run stop before starting another demo.')
    if not ADB.exists(): raise RuntimeError('Set ANDROID_HOME to an Android SDK with platform-tools and emulator')
    if not args.no_build: build()
    name=f'remote-access-api{args.api}'
    avds=LOCAL/'avd'; avds.mkdir(exist_ok=True)
    env={**os.environ,'ANDROID_AVD_HOME':str(avds),'ANDROID_HOME':str(SDK)}
    image=f'system-images;android-{args.api};google_apis;arm64-v8a'
    if not (avds/(name+'.ini')).exists():
        manager=SDK/'cmdline-tools/latest/bin/avdmanager'
        result=subprocess.run([str(manager),'create','avd','--name',name,'--package',image,'--device','pixel_7','--path',str(avds/(name+'.avd'))],env=env,input=b'no\n',capture_output=True)
        if result.returncode: raise RuntimeError(f'Create AVD failed. Install {image} with sdkmanager. See Android SDK tools.')
    serial=f'emulator-{args.emulator_port}'
    listed=run([ADB,'devices'])
    if serial in listed: raise RuntimeError('Chosen emulator port is occupied; stop that emulator or choose --emulator-port')
    proc=None; server=None
    try:
        with (LOCAL/f'emulator-api{args.api}.log').open('w') as log:
            proc=subprocess.Popen([str(EMULATOR),'-avd',name,'-port',str(args.emulator_port),'-no-window','-no-audio','-no-snapshot','-gpu','swiftshader','-no-boot-anim'],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        receipt={'serial':serial,'avd':name,'api':args.api,'emulatorPid':proc.pid}
        private(state_path,receipt)
        wait_for(lambda: adb(serial,'shell','getprop','sys.boot_completed',timeout=5).strip()=='1',180,'emulator boot')
        assert_owned(serial,name)
        adb(serial,'install','-r',str(ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'),timeout=90)
        if 'deviceLocked=1' in adb(serial,'shell','dumpsys','trust'):
            subprocess.run([sys.executable,str(ROOT/'scripts/credential.py'),'unlock'],check=True)
        config={'port':args.port,'phonePort':0,'token':secrets.token_urlsafe(32),'emulator':serial,'adb':str(ADB),'testPinFile':str(LOCAL/f'pin-api{args.api}.txt')}
        private(LOCAL/'server.json',config)
        with (LOCAL/'server.log').open('w') as log:
            server=subprocess.Popen(['node',str(ROOT/'server.mjs')],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        receipt['serverPid']=server.pid; private(state_path,receipt)
        running=wait_for(lambda: json.loads((LOCAL/'running.json').read_text()) if (LOCAL/'running.json').exists() and json.loads((LOCAL/'running.json').read_text()).get('pid')==server.pid else None,20,'demo server')
        receipt['url']=running['url']; private(state_path,receipt)
        provision(serial,{'host':'10.0.2.2','port':running['phonePort'],'token':config['token']})
        if args.with_test_pin and not (LOCAL/f'pin-api{args.api}.ready').exists():
            subprocess.run([sys.executable,str(ROOT/'scripts/credential.py')],check=True)
            provision(serial,{'host':'10.0.2.2','port':running['phonePort'],'token':config['token']})
        adb(serial,'shell','am','start','-n',PACKAGE+'/.StationActivity')
        print(f"Demo ready: {running['url']}\nIsolated Android API {args.api}; native outbound control; USB phones untouched.")
    except Exception:
        if server: server.terminate()
        if proc: proc.terminate()
        state_path.unlink(missing_ok=True)
        raise


def rearm(args):
    data=json.loads((LOCAL/'demo.json').read_text())
    assert_owned(data['serial'],data['avd'])
    trust=adb(data['serial'],'shell','dumpsys','trust')
    if 'deviceLocked=1' in trust: raise RuntimeError('Unlock the disposable emulator before re-arming. Existing access was preserved.')
    if args.restart_server:
        pid=data.get('serverPid')
        if pid:
            command=run(['ps','-p',str(pid),'-o','command='])
            if str(ROOT/'server.mjs') not in command: raise RuntimeError('Demo server identity changed')
            os.kill(pid,signal.SIGTERM)
            wait_for(lambda: not run(['ps','-p',str(pid),'-o','command='],check=False).strip(),10,'server exit')
        with (LOCAL/'server.log').open('w') as log:
            proc=subprocess.Popen(['node',str(ROOT/'server.mjs')],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        data['serverPid']=proc.pid
        private(LOCAL/'demo.json',data)
        wait_for(lambda: json.loads((LOCAL/'running.json').read_text()).get('pid')==proc.pid,20,'server restart')
    running=json.loads((LOCAL/'running.json').read_text())
    adb(data['serial'],'shell','am','force-stop',PACKAGE)
    provision(data['serial'],{'host':'10.0.2.2','port':running['phonePort'],'token':running['token']})
    adb(data['serial'],'shell','am','start','-n',PACKAGE+'/.StationActivity')
    print('Demo access re-armed on the owned emulator.')


def smooth(args):
    data=json.loads((LOCAL/'demo.json').read_text());serial=data['serial']
    assert_owned(serial,data['avd'])
    from client import Client
    client=Client()
    if not client.state()['connected']: raise RuntimeError('Re-arm remote access first')
    adb(serial,'shell','am','start','-n',PACKAGE+'/.SetupActivity','--activity-clear-top')
    wait_for(lambda:click(serial,'Allow smooth screen sharing'),10,'local screen-sharing setup button')
    def accept_consent():
        # This is the disposable emulator's visible platform consent, not an
        # app-op grant or a reusable MediaProjection token.
        nodes=tree(serial)
        labels=[n.get('text','') for n in nodes.iter('node')]
        if not any('screen' in label.lower() for label in labels): return False
        return any(click(serial,label) for label in ['Start now','Start','Share screen'])
    wait_for(accept_consent,15,'visible emulator screen-sharing consent')
    wait_for(lambda:client.state()['state'].get('video',{}).get('active'),15,'consented video service')
    adb(serial,'shell','am','start','-n',PACKAGE+'/.TouchLabActivity')
    print('Smooth view enabled through visible consent on the owned emulator.')


def stop(args):
    path=LOCAL/'demo.json'
    if not path.exists(): print('No owned demo is running.'); return
    data=json.loads(path.read_text())
    try:
        assert_owned(data['serial'],data['avd'])
        adb(data['serial'],'shell','am','force-stop',PACKAGE)
        adb(data['serial'],'emu','kill')
        wait_for(lambda:data['serial'] not in run([ADB,'devices']),20,'owned emulator shutdown')
    except Exception: pass
    pid=data.get('serverPid')
    if pid:
        try:
            command=run(['ps','-p',str(pid),'-o','command='])
            if str(ROOT/'server.mjs') in command: os.kill(pid,signal.SIGTERM)
        except (ProcessLookupError,subprocess.CalledProcessError): pass
    path.unlink(missing_ok=True)
    (LOCAL/'running.json').unlink(missing_ok=True)
    print('Owned demo stopped. Private emulator data remains in .local/avd.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    start_cmd=sub.add_parser('start'); start_cmd.add_argument('--api',choices=['35','36'],default='36')
    start_cmd.add_argument('--port',type=int,default=4317); start_cmd.add_argument('--emulator-port',type=int,default=5580); start_cmd.add_argument('--no-build',action='store_true'); start_cmd.add_argument('--with-test-pin',action='store_true')
    sub.add_parser('stop'); sub.add_parser('build')
    sub.add_parser('smooth')
    rearm_cmd=sub.add_parser('rearm'); rearm_cmd.add_argument('--restart-server',action='store_true')
    args=parser.parse_args()
    try:
        {'start':start,'stop':stop,'rearm':rearm,'smooth':smooth,'build':lambda _:build()}[args.command](args)
    except Exception as exc: print(str(exc),file=sys.stderr); sys.exit(1)

if __name__=='__main__': main()
