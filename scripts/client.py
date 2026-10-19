"""Local HTTP test client; no PINs or tokens in arguments or diagnostics."""
import http.cookiejar
import json
import urllib.error
import urllib.request
from pathlib import Path

class Client:
    def __init__(self,url=None,token=None):
        running=json.loads((Path(__file__).resolve().parents[1]/'.local/running.json').read_text()) if url is None else {}
        self.url=url or running['url']
        # With QR pairing on, the owner-only demo token stands in for a paired browser.
        self.token=token or running.get('token')
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.opener.open(self.url).read()
    def call(self,path,data=None):
        headers={'Content-Type':'application/json','Origin':self.url}
        if self.token: headers['X-Demo-Token']=self.token
        request=urllib.request.Request(self.url+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
        try:
            with self.opener.open(request,timeout=20) as response: return json.load(response)
        except urllib.error.HTTPError as exc:
            payload=json.load(exc)
            raise RuntimeError(payload.get('error','Request failed')) from None
    def action(self,op,**kwargs): return self.call('/api/action',{'op':op,**kwargs})
    def state(self): return self.call('/api/state')
    def lab(self,action,**kwargs): return self.call('/api/lab',{'action':action,**kwargs})
