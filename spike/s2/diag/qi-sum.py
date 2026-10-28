import json,sys,math
def cls(r):
    log=r['log']; q=[x for x in log if x[1]=='qi']
    keys=[x for x in log if x[1].startswith('key')]
    if any(x[2]=='E' for x in keys if x[1] in ('key b','key n')) or r['sel']>0: return 'key to editor'
    if q and q[-1][2].startswith('V'): return 'menu left open'
    return 'normal'
res={}
for arm,files in (('off',sys.argv[1].split(',')),('on',sys.argv[2].split(','))):
    c={}
    for f in files:
        for l in open(f):
            r=json.loads(l)
            if r['type']!='obs': c['error']=c.get('error',0)+1; continue
            k=cls(r); c[k]=c.get(k,0)+1
    res[arm]=c; print(arm, sum(c.values()), c)
# Fisher exact (one-sided) for 'menu left open'
a=res['on'].get('menu left open',0); n1=sum(res['on'].values()); b=res['off'].get('menu left open',0); n2=sum(res['off'].values())
def comb(n,k): return math.comb(n,k)
K=a+b; N=n1+n2
p=sum(comb(n1,x)*comb(n2,K-x)/comb(N,K) for x in range(a,min(n1,K)+1))
print(f"menu left open: on {a}/{n1}, off {b}/{n2}; one-sided Fisher p = {p:.4f}")
