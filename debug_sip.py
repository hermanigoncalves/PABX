import requests
import json

try:
    resp = requests.post('https://automacao-pabx.d2vyhi.easypanel.host/test-sip-call', 
                         json={'phoneNumber': '32998489879'},
                         timeout=10)
    print(json.dumps(resp.json(), indent=2))
except Exception as e:
    print(f"Error: {e}")
    if 'resp' in locals():
        print(resp.text)
