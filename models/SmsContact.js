
const {pool,newId,now,snakeToCamelRow,BaseModel,Document}=require('./db');
class SmsContact extends BaseModel{
 async save(){const t=this.createdAt||now(),u=now();await pool.execute(`INSERT INTO sms_contacts (id,name,phone_number,group_name,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),phone_number=VALUES(phone_number),group_name=VALUES(group_name),notes=VALUES(notes),updated_at=VALUES(updated_at)`,[this._id,this.name,this.phoneNumber,this.group||'General',this.notes||'',this.createdBy||'',t,u]);this.createdAt=this.createdAt||t;this.updatedAt=u;return this;}
}
SmsContact.table='sms_contacts';
SmsContact.allRows=async()=>{const [r]=await pool.execute('SELECT * FROM sms_contacts');return r.map(x=>new SmsContact(snakeToCamelRow(x)));};
SmsContact.hydrate=async d=>new SmsContact(d);
module.exports=SmsContact;
