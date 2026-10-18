#!/usr/bin/env python3
"""Live acceptance on the owned AVD; app control is HTTP -> native accessibility.

ADB is reserved for independent witnesses, emulator lifecycle and local setup.
No raw screenshot or credential is retained in the result report.
"""
import json
from concurrent.futures import ThreadPoolExecutor
import re
import sys
import time
from client import Client
from demo import LOCAL, PACKAGE, ROOT, adb, assert_owned, wait_for

report={'checks':[]}
receipt=json.loads((LOCAL/'demo.json').read_text())
serial=receipt['serial']
assert_owned(serial,receipt['avd'])
c=Client()


def check(name,condition,details=None):
    report['checks'].append({'check':name,'pass':bool(condition),**({'detail':details} if details is not None else {})})
    print(('PASS ' if condition else 'FAIL ')+name,flush=True)
    if not condition: raise AssertionError(name)


def witness(): return json.loads(adb(serial,'shell','run-as',PACKAGE,'cat','files/fixture.json'))


def nodes(): return c.action('inspect')['data']['nodes']


def tap(text=None,resource=None):
    n=wait_for(lambda:next((n for n in nodes() if (text and n.get('text')==text) or (resource and n.get('id')==resource)),None),10,'visible fixture control')
    def fresh_frame():
        result=c.call('/api/frame')
        return result if result['ok'] else None
    frame=wait_for(fresh_frame,10,'fresh frame before gesture')
    a,b,x,y=n['bounds']
    result=c.action('tap',x=(a+x)//2,y=(b+y)//2,frame=frame['data']['frame'])
    if not result['ok']: raise RuntimeError(result['message'])
    return result


def lock_and_show():
    result=c.action('lock'); assert result['ok']
    wait_for(lambda:c.action('state')['state']['locked'],10,'secure lock')
    asleep=c.action('state')['state']
    check('Secure lock preserves process reachability',asleep['locked'] and asleep['secure'])
    result=c.action('wake'); assert result['ok']
    wait_for(lambda:c.action('state')['state']['interactive'],10,'native display wake')
    check('Native display wake does not bypass secure lock',c.action('state')['state']['locked'])
    c.action('dismiss')
    wait_for(lambda:any(n.get('id')=='com.android.systemui:id/pinEntry' for n in nodes()),12,'visible PIN keypad')
    time.sleep(.8)
    wait_for(lambda:any(n.get('id')=='com.android.systemui:id/pinEntry' and n.get('passwordHasText') is False for n in nodes()),5,'stable empty PIN field')


try:
    initial=c.action('state')['state']
    report['platform']={k:initial[k] for k in ['api','release','targetSdk']}
    report['platform']['securityPatch']=adb(serial,'shell','getprop','ro.build.version.security_patch').strip()
    report['platform']['fingerprintType']='Google APIs ARM64 emulator'
    check('No ADB forwarding in the control path',not any(line.startswith(serial+' ') for line in adb(serial,'forward','--list').splitlines()))
    check('Zero wipe threshold on disposable fixture',initial['wipeThreshold']==0)
    check('Synthetic secure credential enrolled',initial['secure'])
    c.action('openFixture'); time.sleep(.4)
    original=witness()
    first=c.call('/api/frame');time.sleep(.8);second=c.call('/api/frame')
    check('Fresh screenshots and independent fixture clock advance',first['ok'] and second['ok'] and first['data']['frame']!=second['data']['frame'] and witness()['tick']>original['tick'])
    tap('Refresh solar reading')
    wait_for(lambda:witness()['watts']==original['watts']+7,5,'solar task effect')
    check('Remote tap changes independently observed solar reading',True)
    before=witness()['output'];tap('AC output');wait_for(lambda:witness()['output']!=before,5,'output toggle')
    check('Remote toggle has independent effect',True)
    tap(resource=PACKAGE+':id/station_name')
    focused=wait_for(lambda:c.action('inspect')['data'].get('focused'),6,'focused native field')
    text='RV · Sonnenenergie ☀ café 日本語'
    result=c.action('text',field=focused['field'],text=text,start=len(text),end=len(text))
    check('Unicode edit accepted on focused native field',result['ok'])
    c.action('nav',button='back');tap('Save name')
    wait_for(lambda:witness()['name']==text,5,'Unicode fixture witness')
    check('Unicode edit matches independent app data',True)
    old=c.call('/api/frame')['data']
    c.action('nav',button='home');time.sleep(.4)
    stale=c.action('tap',x=200,y=200,frame=old['frame'])
    check('Stale screenshot coordinates are refused',not stale['ok'] and 'changed' in stale['message'])
    c.action('openFixture');time.sleep(.4)
    c.lab('rotate',rotation=1)
    wait_for(lambda:c.call('/api/frame').get('data',{}).get('width',0)>c.call('/api/frame').get('data',{}).get('height',9999),10,'landscape capture')
    check('Landscape capture follows native rotation',True)
    c.lab('rotate',rotation=0)
    wait_for(lambda:c.action('state')['state']['rotation']==0,10,'portrait state');time.sleep(1)
    # Rotation may restore a previously focused field and its keyboard.
    if any('inputmethod' in str(n.get('id','')) for n in nodes()): c.action('nav',button='back');time.sleep(.3)
    tap('Test protected screen');wait_for(lambda:witness()['secure'],5,'protected fixture flag');time.sleep(.6)
    protected=c.call('/api/frame')
    check('Protected screen is reported unavailable',not protected['ok'] and 'protected' in protected['message'])
    # Explicit local fixture reset; protected content is never bypassed for viewing.
    adb(serial,'shell','am','start','-n',PACKAGE+'/.StationActivity','--activity-clear-top');time.sleep(.4)
    check('Capture recovers after leaving protected screen',wait_for(lambda:c.call('/api/frame')['ok'],10,'unprotected capture recovery'))
    old_generation=c.state()['generation'];c.lab('disconnect')
    wait_for(lambda:c.state()['connected'] and c.state()['generation']!=old_generation,12,'native reconnect')
    check('App reconnects after transport interruption',True)
    lock_and_show()
    with ThreadPoolExecutor(max_workers=1) as pool:
        attempt=pool.submit(lambda:Client().action('unlock',useTestPin=True))
        wait_for(lambda:c.state()['state'].get('credentialCapturePaused'),5,'credential capture guard')
        paused=c.call('/api/frame')
        check('Credential delivery never exposes a screenshot',not paused['ok'] and 'credential' in paused['message'] and not paused.get('data',{}).get('image'))
        result=attempt.result(timeout=15)
    wait_for(lambda:not c.action('state')['state']['locked'],8,'native known-PIN result')
    os_state=adb(serial,'shell','dumpsys','trust')
    check('Accessibility known-PIN unlock has independent OS effect',result['ok'] and result.get('data',{}).get('locked') is False and 'deviceLocked=0' in os_state)
    lock_and_show()
    result=c.lab('unlock',useTestPin=True)
    wait_for(lambda:not c.action('state')['state']['locked'],8,'prepared shell known-PIN result')
    check('Optional emulator shell unlock has independent OS effect',result['ok'] and 'deviceLocked=0' in adb(serial,'shell','dumpsys','trust'))
    c.action('openFixture')
    check('Viewing recovers after secure lock/unlock',wait_for(lambda:c.call('/api/frame')['ok'],10,'post-unlock screen'))
    check('Stop acknowledges native revocation',c.action('stop')['ok'])
    wait_for(lambda:not c.state()['connected'],5,'native disconnect after Stop')
    time.sleep(2)
    check('Stopped access does not reconnect itself',not c.state()['connected'])
    try: c.action('openFixture'); refused=False
    except RuntimeError: refused=True
    check('Control after Stop is refused',refused)
    report['passed']=True
finally:
    filename=LOCAL/f"acceptance-api{receipt['api']}.json"
    filename.write_text(json.dumps(report,indent=2))
    print(f"Private result: .local/{filename.name}",flush=True)
