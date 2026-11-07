
const {pool,newId,now,snakeToCamelRow,matches,BaseModel,Document}=require('./db');
class MaintenanceReport extends BaseModel {
 async save(){
  const created=this.createdAt||now(),updated=now();
  await pool.execute(`INSERT INTO maintenance_reports
   (id,report_number,company_id,company_name,maintenance_date,employee_name,job_title,signature,created_by,created_by_name,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
   ON DUPLICATE KEY UPDATE report_number=VALUES(report_number),company_id=VALUES(company_id),company_name=VALUES(company_name),
   maintenance_date=VALUES(maintenance_date),employee_name=VALUES(employee_name),job_title=VALUES(job_title),
   signature=VALUES(signature),created_by=VALUES(created_by),created_by_name=VALUES(created_by_name),updated_at=VALUES(updated_at)`,
   [this._id,this.reportNumber,this.company||null,this.companyName||'',this.maintenanceDate||null,this.employeeName||'',this.jobTitle||'',this.signature||'',this.createdBy||null,this.createdByName||'',created,updated]);
  await pool.execute('DELETE FROM maintenance_report_items WHERE report_id=?',[this._id]);
  for(let i=0;i<(this.items||[]).length;i++){const x=this.items[i];await pool.execute(
   `INSERT INTO maintenance_report_items (id,report_id,unit_id,unit_name,imei,serial_number,sim_number,old_imei,old_serial_number,old_sim_number,notes,photos,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
   [x._id||x.id||newId(),this._id,x.unitId||'',x.unitName||'',x.imei||'',x.serialNumber||'',x.simNumber||'',x.oldImei||'',x.oldSerialNumber||'',x.oldSimNumber||'',x.notes||'',JSON.stringify(x.photos||[]),i]);}
  this.createdAt=this.createdAt||created;this.updatedAt=updated;this.id=this._id;return this;
 }
 async deleteOne(){await pool.execute('DELETE FROM maintenance_reports WHERE id=?',[this._id]);}
}
MaintenanceReport.table='maintenance_reports';
MaintenanceReport.allRows=async()=>{const [rows]=await pool.execute('SELECT * FROM maintenance_reports');const out=[];
 for(const r of rows){const d=snakeToCamelRow(r);d.company=d.companyId;const [items]=await pool.execute('SELECT * FROM maintenance_report_items WHERE report_id=? ORDER BY sort_order,id',[r.id]);
 d.items=items.map(x=>{const it=snakeToCamelRow(x);try{it.photos=JSON.parse(it.photos||'[]')}catch{it.photos=[]}return it});out.push(new MaintenanceReport(d));}return out;};
MaintenanceReport.hydrate=async d=>new MaintenanceReport(d);
MaintenanceReport.generateReportNumber=async()=>{const d=new Date(),prefix=`MTR-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;const [r]=await pool.execute('SELECT report_number FROM maintenance_reports WHERE report_number LIKE ? ORDER BY report_number DESC LIMIT 1',[prefix+'-%']);let n=1;if(r[0])n=parseInt(r[0].report_number.split('-').pop(),10)+1;return `${prefix}-${String(n).padStart(4,'0')}`;};
module.exports=MaintenanceReport;
