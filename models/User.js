
const bcrypt = require('bcryptjs');
const {pool,newId,now,snakeToCamelRow,BaseModel,Document} = require('./db');

class User extends BaseModel {
  static PERMISSION_SCREENS = ['dashboard','units','sms','reports','quota','status','whatsapp','wialonReports','adminUsers','maintenance','installations'];
  async setPassword(p){ this.passwordHash=await bcrypt.hash(p,10); }
  async checkPassword(p){ return bcrypt.compare(p,this.passwordHash||''); }
  async save(){
    const created=this.createdAt||now(), updated=now();
    const permissions=JSON.stringify(this.permissions||Object.fromEntries(User.PERMISSION_SCREENS.map(k=>[k,true])));
    const accounts=JSON.stringify(this.wialonAccounts||[]);
    await pool.execute(`
      INSERT INTO users
      (id,username,display_name,role,auth_mode,password_hash,wialon_token,wialon_accounts,report_email,is_active,permissions,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
      username=VALUES(username),display_name=VALUES(display_name),role=VALUES(role),auth_mode=VALUES(auth_mode),
      password_hash=VALUES(password_hash),wialon_token=VALUES(wialon_token),wialon_accounts=VALUES(wialon_accounts),
      report_email=VALUES(report_email),is_active=VALUES(is_active),permissions=VALUES(permissions),updated_at=VALUES(updated_at)`,
      [this._id,this.username,this.displayName||'',this.role||'customer',this.authMode||'local',this.passwordHash||null,
       this.wialonToken||'',accounts,this.reportEmail||'',this.isActive===false?0:1,permissions,created,updated]);
    await pool.execute('DELETE FROM user_assigned_units WHERE user_id=?',[this._id]);
    for(let i=0;i<(this.assignedUnitNames||[]).length;i++)
      await pool.execute('INSERT INTO user_assigned_units (user_id,unit_name,sort_order) VALUES (?,?,?)',[this._id,this.assignedUnitNames[i],i]);
    if(this.permissions && typeof this.permissions.toObject!=='function') Object.defineProperty(this.permissions,'toObject',{value:function(){return {...this}},enumerable:false});
    this.createdAt=this.createdAt||created; this.updatedAt=updated; this.id=this._id;
    return this;
  }
}
User.table='users';
User.mapRow=snakeToCamelRow;
User.allRows=async function(){
  const [rows]=await pool.execute('SELECT * FROM users');
  const out=[];
  for(const r of rows){
    const d=snakeToCamelRow(r);
    const [u]=await pool.execute('SELECT unit_name FROM user_assigned_units WHERE user_id=? ORDER BY sort_order,id',[r.id]);
    d.assignedUnitNames=u.map(x=>x.unit_name);
    if(!d.permissions) d.permissions=Object.fromEntries(User.PERMISSION_SCREENS.map(k=>[k,true]));
    if(d.permissions && typeof d.permissions.toObject!=='function'){
      Object.defineProperty(d.permissions,'toObject',{value:function(){return {...this}},enumerable:false});
    }
    out.push(new User(d));
  }
  return out;
};
User.hydrate=async d=>new User(d);
module.exports=User;
