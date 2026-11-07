
const {pool,snakeToCamelRow,BaseModel,Document}=require('./db');
class SmsLog extends BaseModel{
 async save(){const t=this.createdAt||new Date(),u=new Date();await pool.execute(`INSERT INTO sms_logs (id,receiver_msisdn,sms_text,source,status,error_message,external_trx_id,sent_by,unit_id,unit_name,customer_name,channel,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE receiver_msisdn=VALUES(receiver_msisdn),sms_text=VALUES(sms_text),source=VALUES(source),status=VALUES(status),error_message=VALUES(error_message),external_trx_id=VALUES(external_trx_id),sent_by=VALUES(sent_by),unit_id=VALUES(unit_id),unit_name=VALUES(unit_name),customer_name=VALUES(customer_name),channel=VALUES(channel),updated_at=VALUES(updated_at)`,[this._id,this.receiverMSISDN,this.smsText,this.source||'manual',this.status||'submitted',this.errorMessage||'',this.externalTrxId||'',this.sentBy||'system',this.unitId||'',this.unitName||'',this.customerName||'',this.channel||'sms',t,u]);this.createdAt=this.createdAt||t;this.updatedAt=u;return this;}
}
SmsLog.table='sms_logs';SmsLog.allRows=async()=>{const [r]=await pool.execute('SELECT * FROM sms_logs');return r.map(x=>new SmsLog(snakeToCamelRow(x)));};SmsLog.hydrate=async d=>new SmsLog(d);
module.exports=SmsLog;
