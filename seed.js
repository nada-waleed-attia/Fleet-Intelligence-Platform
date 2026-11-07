
// =====================================================
// SEED SCRIPT - MySQL
// =====================================================
// Run once to create/update the first admin/customer users.
// Usage: node seed.js
// =====================================================
require('dotenv').config();
const User = require('./models/User');

const usersToCreate = [
  {
    username:'admin', password:'ChangeMe123!', displayName:'System Admin',
    role:'admin', wialonAccounts:[], assignedUnitNames:[]
  },
  {
    username:'demo_customer', password:'Customer123!', displayName:'Demo Customer',
    role:'customer', wialonAccounts:[], assignedUnitNames:['CR14','EX-033','GR03'],
    reportEmail:'customer@example.com'
  }
];

async function run(){
  for(const u of usersToCreate){
    let user=await User.findOne({username:u.username});
    if(user){
      user.wialonAccounts=u.wialonAccounts;
      user.assignedUnitNames=u.assignedUnitNames||[];
      user.reportEmail=u.reportEmail||user.reportEmail;
      user.displayName=u.displayName;
      user.role=u.role;
      await user.save();
      console.log(`🔄 Updated "${u.username}"`);
      continue;
    }
    user=new User({
      username:u.username, displayName:u.displayName, role:u.role,
      authMode:'local', wialonAccounts:u.wialonAccounts,
      assignedUnitNames:u.assignedUnitNames||[], reportEmail:u.reportEmail||''
    });
    await user.setPassword(u.password);
    await user.save();
    console.log(`✅ Created ${u.role}: ${u.username} / ${u.password}`);
  }
  console.log('🏁 MySQL seeding done.');
}
run().catch(err=>{console.error('❌ Seed error:',err);process.exit(1);});
