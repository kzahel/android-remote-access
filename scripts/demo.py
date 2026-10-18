#!/usr/bin/env python3
"""Own one isolated emulator and local demo. Never select a physical device."""
import argparse
import glob
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
LOCAL.mkdir(exist_ok=True)
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
    path.write_text(json.dumps(value))
    path.chmod(0o600)


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
    adb(serial,'shell','uiautomator','dump','/data/local/tmp/remote-access-ui.xml')
    data=adb(serial,'shell','cat','/data/local/tmp/remote-access-ui.xml')
    adb(serial,'shell','rm','-f','/data/local/tmp/remote-access-ui.xml')
    return ET.fromstring(data)


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
    apk=ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'
    adb(serial,'install','-r',str(apk),timeout=90)
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
    adb(serial,'shell','am','start','-n',PACKAGE+'/.SetupActivity')
    wait_for(lambda: click(serial,'2 · Start remote access'),30,'native Start button')


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
        config={'port':args.port,'phonePort':0,'token':secrets.token_urlsafe(32),'emulator':serial,'adb':str(ADB),'testPinFile':str(LOCAL/f'pin-api{args.api}.txt')}
        private(LOCAL/'server.json',config)
        with (LOCAL/'server.log').open('w') as log:
            server=subprocess.Popen(['node',str(ROOT/'server.mjs')],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        receipt['serverPid']=server.pid; private(state_path,receipt)
        running=wait_for(lambda: json.loads((LOCAL/'running.json').read_text()) if (LOCAL/'running.json').exists() and json.loads((LOCAL/'running.json').read_text()).get('pid')==server.pid else None,20,'demo server')
        receipt['url']=running['url']; private(state_path,receipt)
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


def stop(args):
    path=LOCAL/'demo.json'
    if not path.exists(): print('No owned demo is running.'); return
    data=json.loads(path.read_text())
    try:
        assert_owned(data['serial'],data['avd'])
        adb(data['serial'],'shell','am','force-stop',PACKAGE)
        adb(data['serial'],'emu','kill')
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
    start_cmd.add_argument('--port',type=int,default=4317); start_cmd.add_argument('--emulator-port',type=int,default=5580); start_cmd.add_argument('--no-build',action='store_true')
    sub.add_parser('stop'); sub.add_parser('build')
    rearm_cmd=sub.add_parser('rearm'); rearm_cmd.add_argument('--restart-server',action='store_true')
    args=parser.parse_args()
    try:
        {'start':start,'stop':stop,'rearm':rearm,'build':lambda _:build()}[args.command](args)
    except Exception as exc: print(str(exc),file=sys.stderr); sys.exit(1)

if __name__=='__main__': main()
