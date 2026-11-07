
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4'
});

function newId() { return crypto.randomBytes(12).toString('hex'); }
function now() { return new Date(); }

function snakeToCamelRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k,v] of Object.entries(row)) {
    const ck = k.replace(/_([a-z])/g, (_,c)=>c.toUpperCase());
    out[ck] = v;
  }
  if (out.id != null) { out._id = out.id; }
  if (out.isActive != null) out.isActive = !!out.isActive;
  if (typeof out.permissions === 'string') { try { out.permissions = JSON.parse(out.permissions); } catch {} }
  if (typeof out.wialonAccounts === 'string') { try { out.wialonAccounts = JSON.parse(out.wialonAccounts) || []; } catch { out.wialonAccounts=[]; } }
  return out;
}
function camelToSnake(k) { return k.replace(/[A-Z]/g, m=>'_'+m.toLowerCase()); }

function getPath(obj, path) {
  return path.split('.').reduce((v,k)=>v == null ? undefined : v[k], obj);
}
function equal(a,b) {
  if (a instanceof Date && b instanceof Date) return a.getTime()===b.getTime();
  if (a instanceof Date && typeof b==='string') return a.getTime()===new Date(b).getTime();
  if (typeof a === 'number' || typeof b === 'number') return String(a)===String(b);
  return a === b;
}
function matchesValue(value, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
    if ('$in' in cond) {
      return cond.$in.some(x => Array.isArray(value) ? value.some(v=>equal(v,x)) : equal(value,x));
    }
    if ('$nin' in cond) return !cond.$nin.some(x=>equal(value,x));
    if ('$gte' in cond && !(value >= cond.$gte)) return false;
    if ('$gt' in cond && !(value > cond.$gt)) return false;
    if ('$lte' in cond && !(value <= cond.$lte)) return false;
    if ('$lt' in cond && !(value < cond.$lt)) return false;
    if ('$regex' in cond) {
      const re = cond.$regex instanceof RegExp ? cond.$regex : new RegExp(cond.$regex, cond.$options || '');
      return re.test(String(value ?? ''));
    }
    if ('$exists' in cond) return (value !== undefined) === !!cond.$exists;
    return Object.entries(cond).every(([k,v])=>matchesValue(getPath(value,k),v));
  }
  if (Array.isArray(value)) return value.some(v=>equal(v,cond));
  return equal(value,cond);
}
function matches(doc, filter={}) {
  return Object.entries(filter).every(([k,v]) => {
    if (k === '$or') return v.some(x=>matches(doc,x));
    if (k === '$and') return v.every(x=>matches(doc,x));
    const val=getPath(doc,k);
    // Mongo nested array matching: items.unitId
    if (k.includes('.') && Array.isArray(doc[k.split('.')[0]])) {
      const [head,...rest]=k.split('.');
      const path=rest.join('.');
      return doc[head].some(item=>matchesValue(getPath(item,path),v));
    }
    return matchesValue(val,v);
  });
}
function sortDocs(docs, spec) {
  const entries=Object.entries(spec||{});
  return docs.sort((a,b)=>{
    for (const [k,dir] of entries) {
      const av=getPath(a,k), bv=getPath(b,k);
      if (equal(av,bv)) continue;
      if (av==null) return dir<0?1:-1;
      if (bv==null) return dir<0?-1:1;
      return (av>bv?1:-1) * (dir<0?-1:1);
    }
    return 0;
  });
}
function applyProjection(doc, projection) {
  if (!projection) return doc;
  const keys = typeof projection === 'string' ? projection.split(/\s+/).filter(Boolean) : Object.keys(projection);
  const exclude = keys.filter(k=> (typeof projection==='string' ? k.startsWith('-') : projection[k]===0)).map(k=>k.replace(/^-/,''));
  const include = keys.filter(k=> (typeof projection==='string' ? !k.startsWith('-') : projection[k]===1));
  const out={...doc};
  if (include.length) {
    const selected={};
    for(const k of include) if (k in doc) selected[k]=doc[k];
    if (doc._id!=null) selected._id=doc._id;
    return selected;
  }
  for(const k of exclude) delete out[k];
  return out;
}

class Query {
  constructor(executor) { this.executor=executor; this.ops=[]; }
  sort(spec){this.ops.push(['sort',spec]); return this;}
  limit(n){this.ops.push(['limit',n]); return this;}
  select(p){this.ops.push(['select',p]); return this;}
  lean(){return this;}
  populate(path, projection){this.ops.push(['populate',path,projection]); return this;}
  then(resolve,reject){ return this.exec().then(resolve,reject); }
  catch(reject){ return this.exec().catch(reject); }
  async exec(){
    let result=await this.executor();
    const many=Array.isArray(result);
    if(many){
      for(const [op,arg] of this.ops){
        if(op==='sort') sortDocs(result,arg);
        else if(op==='limit') result=result.slice(0,arg);
        else if(op==='select') result=result.map(x=>applyProjection(x,arg));
        else if(op==='populate') result=await Promise.all(result.map(x=>populateOne(x,arg,arg)));
      }
    } else {
      for(const [op,arg] of this.ops){
        if(op==='select' && result) result=applyProjection(result,arg);
        else if(op==='populate' && result) result=await populateOne(result,arg,arg);
      }
    }
    return result;
  }
}
async function populateOne(doc,path,projection){
  // Generic User population for the same refs used by the app.
  const refMap={customer:'customer',createdBy:'createdBy',resolvedBy:'resolvedBy',closedBy:'closedBy'};
  const field=refMap[path];
  if(field){
    const id=doc[field];
    if(id){
      const [rows]=await pool.execute('SELECT * FROM users WHERE id=? LIMIT 1',[id]);
      if(rows[0]){
        const u=snakeToCamelRow(rows[0]);
        doc[path]=applyProjection(u,projection);
      }
    }
  }
  return doc;
}

class Document {
  constructor(data={}) { Object.assign(this,data); if(!this._id && this.id)this._id=this.id; if(!this._id)this._id=newId(); this.id=this._id; }
  lean(){ return this; }
  async applyUpdate(update){
    for(const [k,v] of Object.entries(update)){
      if(k.startsWith('$')) continue;
      if(k.includes('.')){
        const [a,b]=k.split('.',2); if(!this[a]||typeof this[a]!=='object')this[a]={}; this[a][b]=v;
      } else this[k]=v;
    }
  }
}

class BaseModel extends Document {
  static table;
  static childHydrate = async ()=>({});
  static childSave = async ()=>{};
  static mapRow = snakeToCamelRow;
  static async allRows(){
    const [rows]=await pool.execute(`SELECT * FROM ${this.table}`);
    return Promise.all(rows.map(r=>this.hydrate(this.mapRow(r))));
  }
  static async hydrate(doc){ return doc; }
  static find(filter={},projection){ return new Query(async()=> (await this.allRows()).filter(d=>matches(d,filter)).map(d=>applyProjection(d,projection))); }
  static findOne(filter={},projection){ return new Query(async()=>{const a=(await this.allRows()).filter(d=>matches(d,filter)); return a.length?applyProjection(a[0],projection):null;});}
  static findById(id,projection){ return this.findOne({_id:String(id)},projection); }
  static async countDocuments(filter={}){ return (await this.allRows()).filter(d=>matches(d,filter)).length; }
  static async distinct(field){ const vals=(await this.allRows()).map(d=>getPath(d,field)).filter(v=>v!=null); return [...new Set(vals)]; }
  static async create(data){ const d=new this(data); await d.save(); return d; }
  static findByIdAndDelete(id){ return new Query(async()=>this.deleteById(id)); }
  static async deleteById(id){ const [r]=await pool.execute(`DELETE FROM ${this.table} WHERE id=?`,[String(id)]); return r.affectedRows?{_id:String(id),id:String(id)}:null; }
  static findByIdAndUpdate(id,update){ return new Query(async()=>{ const d=await this.findById(id); if(!d)return null; await d.applyUpdate(update); await d.save(); return d;});}
}



async function upsertSimple(table,id,fields){
  const cols=Object.keys(fields), vals=Object.values(fields);
  const [ex]=await pool.execute(`SELECT id FROM ${table} WHERE id=? LIMIT 1`,[id]);
  if(ex.length){
    const set=cols.map(c=>`${c}=?`).join(',');
    await pool.execute(`UPDATE ${table} SET ${set} WHERE id=?`,[...vals,id]);
  } else {
    await pool.execute(`INSERT INTO ${table} (id,${cols.join(',')}) VALUES (?,${cols.map(()=>'?').join(',')})`,[id,...vals]);
  }
}
module.exports={pool,newId,now,snakeToCamelRow,camelToSnake,matches,Query,BaseModel,Document,upsertSimple};
