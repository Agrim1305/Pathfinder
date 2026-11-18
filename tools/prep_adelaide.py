"""Turn data/adelaide_raw.json (from fetch_adelaide.py) into the compact file
the demo loads: building outlines and heights, parks, water, rail, and the
walking network as a graph (junctions plus street and path segments).

    python tools/prep_adelaide.py

Coordinates are metres from a point in Victoria Square (equirectangular,
accurate to well under 0.1% across the CBD), stored as integers in half metres.
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json,math,collections,re
from shapely.geometry import Polygon, LineString
import sys, pathlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
SRC=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'data'/'adelaide_raw.json'
DST=ROOT/'docs'/'adelaide'/'data'/'adelaide_cbd.json'
d=json.load(open(SRC))
els=d['elements']
LAT0,LON0=-34.9255,138.6000
KX=math.cos(math.radians(LAT0))*111320; KY=110946
S,W_,N,E_=-34.938,138.583,-34.912,138.617
def P(p): return ((p['lon']-LON0)*KX, (LAT0-p['lat'])*KY)
X0,Y0=P({'lat':N,'lon':W_}); X1,Y1=P({'lat':S,'lon':E_})
q=lambda v: int(round(v*2))  # half metres
def num(s):
    if s is None: return None
    m=re.match(r'\s*([\d.]+)',str(s)); 
    try: return float(m.group(1)) if m else None
    except: return None
# ---- polygons
bld=[];green=[];water=[]
def addpoly(coords,tags,kind):
    if len(coords)<4: return
    pts=[P(p) for p in coords]
    try: pg=Polygon(pts)
    except Exception: return
    if not pg.is_valid: pg=pg.buffer(0)
    if pg.is_empty: return
    if pg.geom_type=='MultiPolygon': pg=max(pg.geoms,key=lambda g:g.area)
    pg=pg.simplify(0.6,preserve_topology=True)
    ring=list(pg.exterior.coords)[:-1]
    if len(ring)<3: return
    flat=[v for x,y in ring for v in (q(x),q(y))]
    if kind=='b':
        h=num(tags.get('height')); est=0
        if h is None:
            lv=num(tags.get('building:levels'))
            if lv is not None: h=lv*3.3+1
            else: h=7 if pg.area<400 else 10; est=1
        h=max(3,min(h,140))
        bld.append([round(h),est]+flat)
    elif kind=='g': green.append(flat)
    else: water.append(flat)
for e in els:
    t=e.get('tags',{})
    if 'highway' in t or 'railway' in t: continue
    kind='b' if 'building' in t else 'w' if t.get('natural')=='water' else 'g' if ('leisure' in t or 'landuse' in t) else None
    if not kind: continue
    if e['type']=='way':
        g=e.get('geometry') or []
        if len(g)>3 and g[0]==g[-1]: addpoly(g,t,kind)
    else:
        for m in e['members']:
            if m.get('role')=='outer' and m.get('geometry') and m['geometry'][0]==m['geometry'][-1]: addpoly(m['geometry'],t,kind)
# waterway lines (river centreline) for width
rivers=[]
for e in els:
    t=e.get('tags',{})
    if e['type']=='way' and t.get('waterway') in ('river','stream','canal'):
        rivers.append([v for p in e['geometry'] for v in map(q,P(p))])
rail=[]
for e in els:
    t=e.get('tags',{})
    if e['type']=='way' and t.get('railway') in ('rail','tram','light_rail'):
        rail.append([v for p in e['geometry'] for v in map(q,P(p))])
# ---- road graph
CLS={'primary':0,'trunk':0,'secondary':0,'primary_link':0,'trunk_link':0,'secondary_link':0,
     'tertiary':1,'tertiary_link':1,'unclassified':1,'residential':1,'living_street':1,
     'service':2,'pedestrian':3,'footway':4,'path':4,'cycleway':4,'steps':4,'track':4}
coord={}; adj=collections.defaultdict(set); ways=[]
for e in els:
    t=e.get('tags',{})
    if e['type']!='way' or t.get('highway') not in CLS: continue
    if t.get('access') in ('private','no') or t.get('foot')=='no': continue
    ns=e['nodes']; gs=e['geometry']
    for nid,g in zip(ns,gs):
        if g: coord[nid]=P(g)
    c=CLS[t['highway']]
    ways.append((ns,c,t.get('name')))
    for a,b in zip(ns,ns[1:]):
        if a in coord and b in coord and a!=b: adj[a].add(b); adj[b].add(a)
# largest component
seen=set(); comps=[]
for s in adj:
    if s in seen: continue
    st=[s]; comp=[]; seen.add(s)
    while st:
        u=st.pop(); comp.append(u)
        for v in adj[u]:
            if v not in seen: seen.add(v); st.append(v)
    comps.append(comp)
big=set(max(comps,key=len))
# edge class/name per segment
segc={}
for ns,c,nm in ways:
    for a,b in zip(ns,ns[1:]):
        k=(min(a,b),max(a,b))
        if k not in segc or c<segc[k][0]: segc[k]=(c,nm)
keep={n for n in big if len(adj[n])!=2}
# also keep endpoints where class changes
for n in big:
    if len(adj[n])==2:
        a,b=list(adj[n]); 
        if segc[(min(a,n),max(a,n))]!=segc[(min(b,n),max(b,n))]: keep.add(n)
idx={n:i for i,n in enumerate(sorted(keep))}
NAMES=['']; NI={'':0}
def nidx(nm):
    nm=(nm or '').replace(' Street',' St').replace(' Terrace',' Tce').replace(' Road',' Rd').replace(' Drive',' Dr')
    if nm not in NI: NI[nm]=len(NAMES); NAMES.append(nm)
    return NI[nm]
edges=[]; done=set()
for s in keep:
    for nb in adj[s]:
        k=(min(s,nb),max(s,nb))
        if k in done: continue
        path=[s,nb]; prev,cur=s,nb; done.add(k)
        while cur not in keep:
            nxt=[x for x in adj[cur] if x!=prev][0]
            done.add((min(cur,nxt),max(cur,nxt))); path.append(nxt); prev,cur=cur,nxt
        L=sum(math.dist(coord[a],coord[b]) for a,b in zip(path,path[1:]))
        c,nm=segc[k]
        mid=[v for n in path[1:-1] for v in map(q,coord[n])]
        edges.append([idx[path[0]],idx[path[-1]],round(L*10),c,nidx(nm)]+mid)
nodes=[v for n in sorted(keep) for v in map(q,coord[n])]
# street labels: longest named major way
lab=collections.defaultdict(float); labpos={}
for ns,c,nm in ways:
    if nm and c<=1:
        pts=[coord[n] for n in ns if n in coord]
        L=sum(math.dist(a,b) for a,b in zip(pts,pts[1:]))
        if L>lab[nm]: lab[nm]=L; labpos[nm]=pts[len(pts)//2]
want=['King William Street','North Terrace','South Terrace','West Terrace','East Terrace','Grenfell Street','Currie Street','Pirie Street','Waymouth Street','Flinders Street','Franklin Street','Wakefield Street','Grote Street','Gouger Street','Angas Street','Pulteney Street','Morphett Street','Frome Street','Hindley Street','Rundle Street','Halifax Street','Sturt Street','Gilbert Street','Gilles Street','Carrington Street','Wright Street','Hutt Street','Rundle Mall','Gawler Place','War Memorial Drive','Victoria Drive','Frome Road','King William Road','Montefiore Road']
streets=[[n.replace(' Street',' St').replace(' Terrace',' Tce').replace(' Road',' Rd').replace(' Drive',' Dr')]+[q(v) for v in labpos[n]] for n in want if n in labpos]
places=[]
for e in els:
    t=e.get('tags',{}); nm=t.get('name','')
    for key,show in [('Adelaide Oval','Adelaide Oval'),('Victoria Square','Victoria Square'),('Light Square','Light Square'),('Hindmarsh Square','Hindmarsh Square'),('Hurtle Square','Hurtle Square'),('Whitmore Square','Whitmore Square'),('Adelaide Central Market','Central Market'),('Adelaide Railway Station','Railway Station'),('Adelaide Festival Centre','Festival Centre'),('Elder Park','Elder Park'),('Torrens Lake','River Torrens'),('Botanic Garden','Botanic Garden'),('Rundle Mall','Rundle Mall')]:
        if nm.startswith(key) and show not in [p[0] for p in places]:
            g=e.get('geometry') or ([pt for m in e.get('members',[]) for pt in (m.get('geometry') or [])])
            if not g: continue
            xs=[P(p) for p in g]; cx=sum(x for x,_ in xs)/len(xs); cy=sum(y for _,y in xs)/len(xs)
            places.append([show,q(cx),q(cy)])
named=collections.defaultdict(set)
for ed in edges:
    if ed[4] and ed[3]<=3: named[ed[0]].add(NAMES[ed[4]]); named[ed[1]].add(NAMES[ed[4]])
inv={v:k for k,v in idx.items()}
def nearest(x,y,want=None):
    best=None
    for i in named:
        if want and want not in named[i]: continue
        cx,cy=coord[inv[i]]
        d2=(cx-x)**2+(cy-y)**2
        if best is None or d2<best[0]: best=(d2,i)
    return best[1]
oval=[p for p in places if p[0]=='Adelaide Oval'][0]; mk=[p for p in places if p[0]=='Central Market'][0]
SP=nearest(oval[1]/2, oval[2]/2+100); EP=nearest(mk[1]/2, mk[2]/2, 'Gouger St')
out=dict(names=NAMES,sp=SP,ep=EP,bbox=[q(X0),q(Y0),q(X1),q(Y1)],b=bld,g=green,w=water,rv=rivers,rl=rail,n=nodes,e=edges,st=streets,pl=places)
s=json.dumps(out,separators=(',',':'))
DST.parent.mkdir(parents=True,exist_ok=True); open(DST,'w').write(s)
print('buildings',len(bld),'est',sum(b[1] for b in bld),'green',len(green),'water',len(water),'nodes',len(nodes)//2,'edges',len(edges),'bytes',len(s))
print(places); print([x[0] for x in streets])
