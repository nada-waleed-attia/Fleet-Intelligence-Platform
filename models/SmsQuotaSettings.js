
const {pool,newId,now,snakeToCamelRow,BaseModel,Document}=require('./db');
class SmsQuotaSettings extends BaseModel{
 async save(){const t=this.createdAt||now(),u=now();await pool.execute(`INSERT INTO sms_quota_settings (id,total_contracted,renewal_day,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE total_contracted=VALUES(total_contracted),renewal_day=VALUES(renewal_day),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)`,[this._id||'main',this.totalContracted||0,this.renewalDay||11,this.updatedBy||'',t,u]);return this;}
}
SmsQuotaSettings.table='sms_quota_settings';
SmsQuotaSettings.allRows=async()=>{const [r]=await pool.execute('SELECT * FROM sms_quota_settings');return r.map(x=>new SmsQuotaSettings(snakeToCamelRow(x)));};
SmsQuotaSettings.getSettings=async()=>{let s=await SmsQuotaSettings.findById('main');if(!s){s=new SmsQuotaSettings({_id:'main',id:'main',totalContracted:0,renewalDay:11});await s.save();}return s;};
module.exports=SmsQuotaSettings;
