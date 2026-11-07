
const {pool,newId,now,snakeToCamelRow,matches,BaseModel}=require('./db');

class MaintenanceRequest extends BaseModel {
 async save(){
  const created=this.createdAt||now(), updated=now();
  await pool.execute(`INSERT INTO maintenance_requests
   (id,request_number,customer_id,customer_name,created_by,created_by_name,title,description,priority,status,assigned_to,assigned_to_name,
    resolution,resolved_by,resolved_by_name,resolved_at,closed_by,closed_by_name,closed_at,received_at,started_at,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON DUPLICATE KEY UPDATE request_number=VALUES(request_number),customer_id=VALUES(customer_id),customer_name=VALUES(customer_name),
   created_by=VALUES(created_by),created_by_name=VALUES(created_by_name),title=VALUES(title),description=VALUES(description),
   priority=VALUES(priority),status=VALUES(status),assigned_to=VALUES(assigned_to),assigned_to_name=VALUES(assigned_to_name),
   resolution=VALUES(resolution),resolved_by=VALUES(resolved_by),resolved_by_name=VALUES(resolved_by_name),resolved_at=VALUES(resolved_at),
   closed_by=VALUES(closed_by),closed_by_name=VALUES(closed_by_name),closed_at=VALUES(closed_at),received_at=VALUES(received_at),
   started_at=VALUES(started_at),updated_at=VALUES(updated_at)`,
   [this._id,this.requestNumber,this.customer||null,this.customerName||'',this.createdBy||null,this.createdByName||'',this.title||'',this.description||'',
    this.priority||'medium',this.status||'pending',this.assignedTo||null,this.assignedToName||'',this.resolution||'',this.resolvedBy||null,
    this.resolvedByName||'',this.resolvedAt||null,this.closedBy||null,this.closedByName||'',this.closedAt||null,this.receivedAt||null,this.startedAt||null,created,updated]);

  await pool.execute('DELETE FROM maintenance_request_vehicles WHERE request_id=?',[this._id]);
  for(let i=0;i<(this.vehicles||[]).length;i++){const x=this.vehicles[i];await pool.execute(
    'INSERT INTO maintenance_request_vehicles (id,request_id,unit_id,unit_name,sort_order) VALUES (?,?,?,?,?)',
    [x._id||x.id||newId(),this._id,x.unitId||'',x.unitName||'',i]);}

  await pool.execute('DELETE FROM maintenance_request_messages WHERE request_id=?',[this._id]);
  for(let i=0;i<(this.messages||[]).length;i++){const x=this.messages[i];await pool.execute(
    'INSERT INTO maintenance_request_messages (id,request_id,sender_id,sender_name,sender_role,message,created_at,sort_order) VALUES (?,?,?,?,?,?,?,?)',
    [x._id||x.id||newId(),this._id,x.sender||null,x.senderName||'',x.senderRole||'',x.message||'',x.createdAt||now(),i]);}

  await pool.execute('DELETE FROM maintenance_request_history WHERE request_id=?',[this._id]);
  for(let i=0;i<(this.history||[]).length;i++){const x=this.history[i];await pool.execute(
    'INSERT INTO maintenance_request_history (id,request_id,action,by_user_id,by_name,details,created_at,sort_order) VALUES (?,?,?,?,?,?,?,?)',
    [x._id||x.id||newId(),this._id,x.action||'',x.by||null,x.byName||'',x.details||'',x.createdAt||now(),i]);}

  this.createdAt=this.createdAt||created;this.updatedAt=updated;this.id=this._id;return this;
 }
 async deleteOne(){await pool.execute('DELETE FROM maintenance_requests WHERE id=?',[this._id]);}
}

MaintenanceRequest.table='maintenance_requests';
MaintenanceRequest.allRows=async()=>{
 const [rows]=await pool.execute('SELECT * FROM maintenance_requests'); const out=[];
 for(const r of rows){
  const d=snakeToCamelRow(r); d.customer=d.customerId; d.createdBy=d.createdBy; d.assignedTo=d.assignedTo; d.resolvedBy=d.resolvedBy; d.closedBy=d.closedBy;
  const [v]=await pool.execute('SELECT * FROM maintenance_request_vehicles WHERE request_id=? ORDER BY sort_order,id',[r.id]);
  const [m]=await pool.execute('SELECT * FROM maintenance_request_messages WHERE request_id=? ORDER BY sort_order,id',[r.id]);
  const [h]=await pool.execute('SELECT * FROM maintenance_request_history WHERE request_id=? ORDER BY sort_order,id',[r.id]);
  d.vehicles=v.map(x=>snakeToCamelRow(x));
  d.messages=m.map(x=>snakeToCamelRow(x));
  d.history=h.map(x=>snakeToCamelRow(x));
  out.push(new MaintenanceRequest(d));
 }
 return out;
};
MaintenanceRequest.hydrate=async d=>new MaintenanceRequest(d);
MaintenanceRequest.generateRequestNumber=async()=>{
 const d=new Date(),prefix=`MNT-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
 const [r]=await pool.execute('SELECT request_number FROM maintenance_requests WHERE request_number LIKE ? ORDER BY request_number DESC LIMIT 1',[prefix+'-%']);
 let n=1;if(r[0]){const x=parseInt(r[0].request_number.split('-').pop(),10);if(Number.isFinite(x))n=x+1;}
 return `${prefix}-${String(n).padStart(4,'0')}`;
};
module.exports=MaintenanceRequest;
