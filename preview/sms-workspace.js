// EDIT BY NADA — SMS presentation and accessible controls inside the existing isolated preview.
(() => {
  const $=id=>document.getElementById(id);
  const icon=name=>{const node=document.createElement('span');node.className='sm-icon';node.setAttribute('aria-hidden','true');node.innerHTML=ObserverIcons.svg(name);return node;};
  const labelButton=(node,symbol,label)=>{const text=document.createElement('span');text.textContent=label;node.replaceChildren(icon(symbol),text);};
  const backdrop=document.createElement('div');backdrop.className='sm-backdrop';backdrop.setAttribute('aria-hidden','true');backdrop.innerHTML='<div class="sm-glow sm-glow-green"></div><div class="sm-glow sm-glow-gold"></div><div class="sm-contours"></div><div class="sm-grid-floor"></div>';document.body.prepend(backdrop);
  const page=document.createElement('main');page.className='sm-page';
  const header=document.querySelector('.header'),tabs=document.querySelector('.tabs'),panels=[...document.querySelectorAll('.panel')];header.before(page);page.append(header,tabs,...panels);
  const brand=document.querySelector('.brand'),copy=document.createElement('div');copy.className='sm-brand-copy';const eyebrow=document.createElement('div');eyebrow.className='sm-eyebrow';eyebrow.textContent='OBSERVER FLEET';
  const subtitle=document.createElement('p');subtitle.className='sm-brand-subtitle';subtitle.textContent='Messaging center';copy.append(eyebrow,brand.querySelector('h1'),subtitle);brand.append(copy);
  labelButton(document.querySelector('.header-buttons .back-btn'),'arrow-left','Dashboard');
  const tabData=[['send','message-square','Send message'],['contacts','users','Contacts'],['report','file-chart-column','Message history'],['quota','chart-column','Quota & usage']];tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Messaging sections');
  tabData.forEach(([key,symbol,title])=>{const button=tabs.querySelector(`[data-tab="${key}"]`);labelButton(button,symbol,title);button.id=`sm-tab-${key}`;button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-controls',`panel-${key}`);const panel=$(`panel-${key}`);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);});
  const syncTabs=()=>tabData.forEach(([key])=>{const button=$(`sm-tab-${key}`),active=button.classList.contains('active');button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
  const switchTab=window.switchTab;window.switchTab=key=>{closeMenus();switchTab(key);syncTabs();};
  tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...tabs.querySelectorAll('button')].filter(button=>getComputedStyle(button).display!=='none'),current=buttons.indexOf(document.activeElement);if(current<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();window.switchTab(buttons[next].dataset.tab);});syncTabs();
  const panelHead=(panel,title,description,symbol)=>{const heading=document.createElement('div');heading.className='sm-panel-heading';const words=document.createElement('div'),h=document.createElement('h2'),p=document.createElement('p');h.textContent=title;p.textContent=description;words.append(h,p);const tile=icon(symbol);tile.classList.add('sm-heading-mark');heading.append(words,tile);panel.prepend(heading);};
  // EDIT BY NADA — the page header already names this workspace; start the composer with its channel controls.
  panelHead($('panel-contacts'),'Contacts','Add contacts, select several numbers and start a message.','users');
  panelHead($('panel-report'),'Message history','Review local attempts, channels and delivery status.','file-chart-column');
  panelHead($('panel-quota'),'Quota & usage','Review local usage and manage the renewal cycle.','chart-column');
  $('panel-contacts').querySelector(':scope > .hint')?.remove();
  const send=$('panel-send'),composer=document.createElement('div');composer.className='sm-composer';[...send.children].filter(node=>!node.classList.contains('sm-panel-heading')).forEach(node=>composer.append(node));
  // EDIT BY NADA — an optional inline preview replaces the oversized decorative phone column.
  const preview=document.createElement('details');preview.className='sm-message-preview';preview.setAttribute('aria-label','Message preview');
  preview.innerHTML='<summary>Message preview</summary><div class="sm-preview-content"><div class="sm-preview-head"><span id="sm-preview-channel">SMS</span><span class="sm-preview-recipient" id="sm-preview-unit">Choose recipients</span></div><div class="sm-message-bubble" id="sm-preview-text">Your message appears here.</div><div class="sm-preview-metrics"><div><strong id="sm-recipient-count">0</strong><span>Recipients</span></div><div><strong id="sm-character-count">0</strong><span>Characters</span></div></div></div>';
  preview.querySelector('summary').prepend(icon('message-square'));
  composer.querySelector('#send-text').dir='auto';preview.querySelector('#sm-preview-text').dir='auto';
  // EDIT BY NADA — keep composing in one compact column, with preview tucked below the message.
  const sendGrid=document.createElement('div');sendGrid.className='sm-send-grid';sendGrid.append(composer);send.append(sendGrid);
  // Retain private compatibility fields for the original loaders; their filter UI is removed.
  const oldRow=composer.querySelector('.row'),legacy=document.createElement('div');legacy.hidden=true;
  ['send-channel','send-group-picker','send-unit-picker'].forEach(id=>{const select=$(id);select.hidden=true;legacy.append(select);});oldRow.replaceWith(legacy);
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const button=(text,cls,action)=>{const node=el('button',cls,text);node.type='button';node.addEventListener('click',action);return node;};
  const request=async(path,options)=>{const response=await fetch(path,options),data=await response.json();if(!data.success)throw new Error(data.error||'Unable to load recipients.');return data;};
  const normalizePhone=value=>{let text=String(value||'').trim();if(/^DEMO-\d{3}$/.test(text))return text;text=text.replace(/[\s().-]/g,'').replace(/^\+/,'').replace(/^00/,'');if(/^01[0125]\d{8}$/.test(text))text='20'+text.slice(1);return /^\d{10,15}$/.test(text)?text:'';};
  const simOf=unit=>unit.mobileNumber||unit.phoneNumber||unit.simNumber||unit.ph||'';
  // EDIT BY NADA — unit and contact loading errors stay independent.
  // EDIT BY NADA — distinguish a connection awaiting setup from an actual loading error.
  const state={units:[],contacts:[],selected:new Map(),source:'unit',loading:true,unitConnection:'loading',errors:{unit:'',contact:''},sending:false};
  const records=()=>state.source==='unit'?state.units:state.contacts;
  const idOf=(record,kind)=>String(kind==='unit'?record.id:record._id||record.id);
  // EDIT BY NADA — use the backend device type alongside the backend SIM and account fields.
  const toRecipient=(record,kind)=>({kind,id:idOf(record,kind),name:record.name||String(record.id||''),number:String(kind==='unit'?simOf(record):record.phoneNumber||''),account:kind==='unit'?record.accountGroup||'':record.group||'',deviceType:kind==='unit'?record.deviceType||'':'',status:record.status||''});
  const channelBar=el('div','sm-channel-tabs');channelBar.setAttribute('role','tablist');channelBar.setAttribute('aria-label','Message channel');
  const channelButtons=['sms','whatsapp'].map(value=>{const node=button(value==='sms'?'SMS (Vodafone)':'WhatsApp','sm-channel-tab',()=>{closeMenus();$('send-channel').value=value;$('send-channel').dispatchEvent(new Event('change',{bubbles:true}));});node.id='sm-channel-'+value;node.dataset.channel=value;node.setAttribute('role','tab');node.setAttribute('aria-controls','sm-compose-fields');node.prepend(icon('message-square'));channelBar.append(node);return node;});
  composer.id='sm-compose-fields';composer.prepend(channelBar);
  const picker=el('section','sm-recipient-picker');picker.setAttribute('aria-label','Choose message recipients');
  picker.innerHTML='<div class="sm-picker-heading"><div><h3>Choose recipients</h3><p id="sm-picker-context">Select units. Their SIM numbers are read from the available unit data.</p></div><span id="sm-selected-total" role="status">0 selected</span></div><div class="sm-recipient-sources" role="tablist" aria-label="Recipient source"><button type="button" data-recipient-source="unit" role="tab" aria-controls="sm-recipient-list">Units</button><button type="button" data-recipient-source="contact" role="tab" aria-controls="sm-recipient-list">Contacts</button></div><div class="sm-picker-tools"><label class="sm-picker-search"><span>Search units</span><input id="sm-recipient-search" type="search" placeholder="Unit name, ID, account or SIM number…" autocomplete="off"></label><button type="button" id="sm-refresh-recipients" aria-label="Refresh recipients">Refresh</button></div><div class="sm-picker-bulk"><span id="sm-visible-count" role="status">Loading units…</span><div><button type="button" id="sm-select-visible">Select filtered</button><button type="button" id="sm-clear-selection">Clear selected</button></div></div><div id="sm-recipient-list" class="sm-recipient-list" role="group" aria-label="Available units"></div><div id="sm-recipient-warning" class="sm-recipient-warning" role="status" hidden></div><div id="sm-selected-recipients" class="sm-selected-recipients" aria-label="Selected recipients"></div>';
  channelBar.after(picker);
  // EDIT BY NADA — combine title, source tabs, count and refresh into a single recipient toolbar.
  const pickerHeading=picker.querySelector('.sm-picker-heading');pickerHeading.querySelector('h3').textContent='Recipients';$('sm-picker-context').classList.add('sm-sr-only');
  pickerHeading.append(picker.querySelector('.sm-recipient-sources'),$('sm-refresh-recipients'));picker.querySelector('.sm-picker-search>span').classList.add('sm-sr-only');
  // EDIT BY NADA — reserve a clear connection state without asking the user for tokens.
  // EDIT BY NADA — announce connection changes accessibly; the empty list carries the visible waiting state once.
  const connection=el('span','sm-wialon-connection sm-sr-only');connection.id='sm-wialon-connection';connection.setAttribute('role','status');picker.querySelector('.sm-picker-heading').after(connection);
  // EDIT BY NADA — units use explicit Available/Selected boxes; contacts keep their existing picker.
  const unitHost=el('div','sm-unit-transfer');unitHost.id='sm-unit-transfer';$('sm-recipient-list').after(unitHost);
  picker.querySelector('[data-recipient-source="unit"]').setAttribute('aria-controls',unitHost.id);
  const unitTransfer=ObserverUnitTransfer.create({host:unitHost,onChange:units=>{
    state.selected.forEach((item,key)=>{if(item.kind==='unit')state.selected.delete(key);});
    units.forEach(unit=>{const item=toRecipient(unit,'unit');state.selected.set('unit:'+item.id,item);});
    renderRecipients();
  }});
  // EDIT BY NADA — keep extra numbers optional and avoid duplicate visible labels and instructions.
  const manual=el('details','sm-manual-numbers'),manualSummary=el('summary','','Add numbers manually'),numbers=$('send-numbers'),numberLabel=numbers.previousElementSibling,numberHint=numbers.nextElementSibling;manual.append(manualSummary);numbers.before(manual);manual.append(numberLabel,numbers,numberHint);numberLabel.textContent='Additional phone numbers';numberLabel.classList.add('sm-sr-only');numberHint.textContent='Separate numbers with commas or new lines.';numbers.placeholder='201000000000\nor one number per line';
  const messageLabel=$('send-text').previousElementSibling;messageLabel.textContent='Message';$('send-text').rows=3;
  const messageContext=el('p','sm-message-context sm-sr-only');messageContext.id='sm-message-context';$('send-text').before(messageContext);$('send-text').setAttribute('aria-describedby',messageContext.id);$('send-text').placeholder='Write your message…';
  const whatsappHint=el('p','sm-whatsapp-hint','Use WhatsApp for recipients who can receive business messages, including an approved template when required.');$('send-text').after(whatsappHint);
  // EDIT BY NADA — native disclosure keeps preview available with keyboard and touch without occupying a column.
  whatsappHint.after(preview);
  const sendButton=send.querySelector('.send-btn');labelButton(sendButton,'message-square','Simulate message');
  // EDIT BY NADA — retain one short, accurate simulation notice beside the action.
  const sendActions=el('div','sm-send-actions');sendButton.before(sendActions);sendActions.append(sendButton);const statusHint=el('span','','Preview only · messages are not sent.');sendActions.append(statusHint);$('send-result').setAttribute('aria-live','polite');
  preview.querySelector('#sm-recipient-count').nextElementSibling.textContent='Unique recipients';
  const manualNumbers=()=>numbers.value.split(/[,;\n]+/).map(value=>value.trim()).filter(Boolean);
  const selectedPhones=()=>[...new Set([...state.selected.values()].map(item=>normalizePhone(item.number)).concat(manualNumbers().map(normalizePhone)).filter(Boolean))];
  const syncChannels=()=>{channelButtons.forEach(node=>{const available=[...$('send-channel').options].some(option=>option.value===node.dataset.channel&&!option.disabled);node.disabled=!available;const active=$('send-channel').value===node.dataset.channel;node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;node.classList.toggle('is-active',active);});};
  channelBar.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;const choices=channelButtons.filter(node=>!node.disabled),current=choices.indexOf(document.activeElement);if(current<0)return;event.preventDefault();const next=choices[(current+(event.key==='ArrowRight'?1:-1)+choices.length)%choices.length];next.focus();next.click();});
  const updatePreview=()=>{const text=$('send-text').value,channel=$('send-channel').value,selected=[...state.selected.values()],unitCount=selected.filter(item=>item.kind==='unit').length,contactCount=selected.length-unitCount,missing=selected.filter(item=>!normalizePhone(item.number));$('sm-recipient-count').textContent=selectedPhones().length;$('sm-character-count').textContent=Array.from(text).length;$('sm-preview-channel').textContent=channel==='whatsapp'?'WhatsApp':'SMS';$('sm-preview-unit').textContent=selected.length?`${unitCount} unit${unitCount===1?'':'s'} · ${contactCount} contact${contactCount===1?'':'s'}`:manualNumbers().length?'Additional numbers':'Choose recipients';$('sm-preview-text').textContent=text||'Your message appears here.';$('sm-preview-text').classList.toggle('is-placeholder',!text);whatsappHint.hidden=channel!=='whatsapp';messageContext.textContent=unitCount?'This message is addressed to the selected units using their recorded SIM numbers. Use the message or device command approved for those units.':contactCount?'This message is addressed to the selected saved contact numbers.':'Select units or saved contacts to define who will receive this message.';$('sm-selected-total').textContent=`${selected.length} selected`;$('sm-recipient-warning').hidden=!missing.length;$('sm-recipient-warning').textContent=missing.length?`${missing.length} selected recipient${missing.length===1?' is':'s are'} missing a valid ${missing.some(item=>item.kind==='unit')?'SIM or phone number':'phone number'}. Review or remove these selections before continuing.`:'';syncChannels();syncContactSelection();};
  const changeSelection=(record,kind,checked)=>{const item=toRecipient(record,kind),key=kind+':'+item.id,active=document.activeElement,inPicker=active?.closest('#sm-recipient-list');if(checked)state.selected.set(key,item);else state.selected.delete(key);renderRecipients();if(inPicker)[...$('sm-recipient-list').querySelectorAll('input')].find(input=>input.dataset.recipientId===item.id&&input.dataset.kind===kind)?.focus({preventScroll:true});};
  // EDIT BY NADA — device models returned by Wialon are searchable without a fixed model list.
  const filteredRecords=()=>{const term=$('sm-recipient-search').value.trim().toLowerCase();return records().filter(record=>{const item=toRecipient(record,state.source);return[item.name,item.id,item.number,item.account,item.deviceType,record.serialNumber].join(' ').toLowerCase().includes(term);});};
  function renderRecipients(){
    const list=$('sm-recipient-list');list.replaceChildren();const matches=filteredRecords();$('sm-visible-count').textContent=state.loading?'Loading recipients…':`${matches.length} of ${records().length} ${state.source==='unit'?'units':'contacts'}`;
    // EDIT BY NADA — only the right-hand box contributes unit recipients; staged left rows stay separate.
    const unitView=state.source==='unit';unitHost.hidden=!unitView;list.hidden=unitView;
    unitTransfer.update({units:state.units,selectedIds:[...state.selected.values()].filter(item=>item.kind==='unit').map(item=>item.id),phase:state.loading?'loading':state.unitConnection,error:state.errors.unit});
    // EDIT BY NADA — ready-to-connect placeholder uses field labels only, never fabricated units or device models.
    const pending=state.source==='unit'&&!state.loading&&state.unitConnection==='pending';
    connection.hidden=state.source!=='unit';connection.dataset.state=state.loading?'loading':state.unitConnection;
    connection.textContent=state.loading?'Loading Wialon units…':state.unitConnection==='pending'?'Ready for Wialon connection':state.unitConnection==='error'?'Unable to load Wialon units':'Wialon units loaded';
    $('sm-recipient-search').disabled=state.loading||pending;
    $('sm-recipient-search').placeholder=pending?'Units will appear after connection…':state.source==='unit'?'Unit name, device type, account or SIM…':'Contact name, group or phone number…';
    list.setAttribute('aria-busy',String(state.loading));
    // EDIT BY NADA — remove empty counters and inactive search/bulk controls from the disconnected view.
    // EDIT BY NADA — the shared transfer component owns unit search, status and bulk actions.
    picker.querySelector('.sm-picker-tools').hidden=unitView;
    picker.querySelector('.sm-picker-bulk').hidden=unitView||state.loading||!records().length;
    $('sm-selected-total').hidden=!state.selected.size;
    // EDIT BY NADA — explain unavailable integration data; saved contacts remain usable independently.
    const error=state.errors[state.source];
    // EDIT BY NADA — preserve the single-box contact workflow independently of unit staging.
    if(!unitView&&(state.loading||error||!matches.length)){list.append(el('p','sm-picker-empty',state.loading?'Loading recipients…':error||(!records().length?'No saved contacts yet. Add contacts in the Contacts section.':'No recipients match your search.')));}
    // EDIT BY NADA — display the captured device type; missing models remain an explicit dash.
    else if(!unitView) matches.forEach(record=>{const item=toRecipient(record,'contact'),row=el('label','sm-recipient-option'),check=el('input');check.type='checkbox';check.checked=state.selected.has('contact:'+item.id);check.dataset.recipientId=item.id;check.dataset.kind='contact';check.setAttribute('aria-label','Select '+item.name);check.addEventListener('change',()=>changeSelection(record,'contact',check.checked));const copy=el('span','sm-recipient-copy'),name=el('strong','',item.name),meta=el('small','',item.account||'Saved contact'),phone=el('span','sm-recipient-phone',normalizePhone(item.number)?`Phone · ${item.number}`:'Phone number missing');if(!normalizePhone(item.number))phone.classList.add('is-missing');if(/^DEMO-/.test(item.number))phone.textContent=`Demo number · ${item.number}`;copy.append(name,meta);row.append(check,icon('users'),copy,phone);list.append(row);});
    // EDIT BY NADA — selected units are already visible in the right box; retain chips only for contacts.
    const chips=$('sm-selected-recipients');chips.replaceChildren();state.selected.forEach((item,key)=>{if(item.kind!=='contact')return;const chip=button(item.name,'sm-recipient-chip',()=>{state.selected.delete(key);renderRecipients();});chip.setAttribute('aria-label','Remove '+item.name+' from recipients');chip.append(el('span','','×'));chips.append(chip);});
    $('sm-refresh-recipients').disabled=state.loading;$('sm-select-visible').disabled=state.loading||!matches.length;$('sm-clear-selection').disabled=!state.selected.size;updatePreview();
  }
  const setSource=source=>{state.source=source;$('sm-recipient-search').value='';document.querySelectorAll('[data-recipient-source]').forEach(node=>{const active=node.dataset.recipientSource===source;node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;});$('sm-recipient-search').placeholder=source==='unit'?'Unit name, ID, account or SIM number…':'Contact name, group or phone number…';$('sm-recipient-search').previousElementSibling.textContent=source==='unit'?'Search units':'Search contacts';$('sm-recipient-list').setAttribute('aria-label',source==='unit'?'Available units':'Saved contacts');$('sm-picker-context').textContent=source==='unit'?'Select units. Their SIM numbers are read from the available unit data.':'Select contacts already saved to the platform. Their phone numbers are added automatically.';renderRecipients();};
  document.querySelectorAll('[data-recipient-source]').forEach(node=>node.addEventListener('click',()=>setSource(node.dataset.recipientSource)));
  picker.querySelector('.sm-recipient-sources').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const choices=[...picker.querySelectorAll('[data-recipient-source]')],current=choices.indexOf(document.activeElement),next=choices[(current+1)%choices.length];next.click();next.focus();});
  // EDIT BY NADA — contact actions preserve independently moved unit recipients.
  $('sm-recipient-search').addEventListener('input',renderRecipients);$('sm-select-visible').addEventListener('click',()=>{if(state.source!=='contact')return;filteredRecords().forEach(record=>{const item=toRecipient(record,'contact');state.selected.set('contact:'+item.id,item);});renderRecipients();});$('sm-clear-selection').addEventListener('click',()=>{state.selected.forEach((item,key)=>{if(item.kind===state.source)state.selected.delete(key);});renderRecipients();});
  // EDIT BY NADA — the picker uses the authenticated Wialon endpoint, with no dashboard/demo fallback.
  async function refreshRecipients(){
    // EDIT BY NADA — retry can transition the same prepared frontend into a connected list later.
    state.loading=true;state.unitConnection='loading';state.errors={unit:'',contact:''};renderRecipients();
    const results=await Promise.allSettled([request('/api/sms/units'),request('/api/contacts')]);
    // EDIT BY NADA — pending setup, empty successful results and failures have separate states.
    results.forEach((result,index)=>{const source=index===0?'unit':'contact',field=index===0?'units':'contacts';if(result.status==='fulfilled'){const data=result.value;state[field]=Array.isArray(data[field])?data[field]:[];if(source==='unit'){state.unitConnection=data.integrationAvailable===false?'pending':'connected';if(state.unitConnection==='pending')state.units=[];}}else{state[field]=[];state.errors[source]=result.reason.message;if(source==='unit')state.unitConnection='error';}});
    state.selected.forEach((item,key)=>{const record=(item.kind==='unit'?state.units:state.contacts).find(record=>idOf(record,item.kind)===item.id);if(record)state.selected.set(key,toRecipient(record,item.kind));else state.selected.delete(key);});
    state.loading=false;renderContacts();renderRecipients();
  }
  $('sm-refresh-recipients').addEventListener('click',refreshRecipients);
  // Contacts share the same selection state as the composer; keep the original add/delete actions.
  const contactsPanel=$('panel-contacts'),contactTools=el('div','sm-contact-tools');contactTools.innerHTML='<label>Search saved contacts<input id="sm-contact-search" type="search" placeholder="Name, number or group…"></label><span id="sm-contact-selection" role="status">0 contacts selected</span><button type="button" id="sm-message-contacts">Message selected contacts</button>';
  contactsPanel.querySelector('table').before(contactTools);$('sm-contact-search').addEventListener('input',()=>renderContacts());$('sm-message-contacts').addEventListener('click',()=>{setSource('contact');window.switchTab('send');picker.scrollIntoView({block:'start',behavior:'smooth'});$('send-text').focus({preventScroll:true});});
  const contactHeader=contactsPanel.querySelector('thead tr'),selectHead=el('th'),contactSelectAll=el('input');contactSelectAll.type='checkbox';contactSelectAll.id='sm-contact-select-all';contactSelectAll.setAttribute('aria-label','Select all filtered contacts');selectHead.append(contactSelectAll);contactHeader.prepend(selectHead);
  const matchingContacts=()=>{const term=$('sm-contact-search').value.trim().toLowerCase();return state.contacts.filter(contact=>[contact.name,contact.phoneNumber,contact.group].join(' ').toLowerCase().includes(term));};
  contactSelectAll.addEventListener('change',()=>{matchingContacts().forEach(record=>{const item=toRecipient(record,'contact'),key='contact:'+item.id;if(contactSelectAll.checked)state.selected.set(key,item);else state.selected.delete(key);});renderContacts();renderRecipients();});
  function syncContactSelection(){const count=[...state.selected.values()].filter(item=>item.kind==='contact').length;$('sm-contact-selection').textContent=`${count} contact${count===1?'':'s'} selected`;$('sm-message-contacts').disabled=!count;const visible=matchingContacts(),selected=visible.filter(record=>state.selected.has('contact:'+idOf(record,'contact'))).length;contactSelectAll.checked=!!visible.length&&selected===visible.length;contactSelectAll.indeterminate=selected>0&&selected<visible.length;$('contacts-body').querySelectorAll('input[data-contact-id]').forEach(check=>check.checked=state.selected.has('contact:'+check.dataset.contactId));}
  function renderContacts(){const body=$('contacts-body');body.replaceChildren();const matches=matchingContacts();$('contacts-empty').style.display=matches.length?'none':'block';$('contacts-empty').textContent=state.contacts.length?'No saved contacts match your search.':'No saved contacts yet. Add a contact above to get started.';matches.forEach(contact=>{const row=el('tr'),cell=el('td'),check=el('input');check.type='checkbox';check.dataset.contactId=idOf(contact,'contact');check.checked=state.selected.has('contact:'+check.dataset.contactId);check.setAttribute('aria-label','Select '+contact.name);check.addEventListener('change',()=>changeSelection(contact,'contact',check.checked));cell.append(check);row.append(cell);[contact.name,contact.phoneNumber,contact.group||'General'].forEach(value=>row.append(el('td','',value)));const actions=el('td');actions.append(button('Delete','danger-btn',()=>window.deleteContact(contact._id||contact.id)));row.append(actions);body.append(row);});syncContactSelection();}
  window.loadContacts=async()=>{try{const data=await request('/api/contacts');state.contacts=data.contacts||[];state.selected.forEach((item,key)=>{if(item.kind!=='contact')return;const record=state.contacts.find(record=>idOf(record,'contact')===item.id);if(record)state.selected.set(key,toRecipient(record,'contact'));else state.selected.delete(key);});renderContacts();renderRecipients();}catch(error){$('contacts-empty').textContent=error.message;$('contacts-empty').style.display='block';}};
  window.loadSendHelpers=refreshRecipients;window.loadGroupIntoNumbers=()=>{};
  ['send-numbers','send-text'].forEach(id=>$(id).addEventListener('input',updatePreview));$('send-channel').addEventListener('change',updatePreview);new MutationObserver(syncChannels).observe($('send-channel'),{childList:true,subtree:true});
  const resultRow=(message,failed=false)=>{const row=el('div','result-row '+(failed?'result-fail':'result-simulated'),message);$('send-result').append(row);};
  window.sendSms=async()=>{
    if(state.sending)return;const text=$('send-text').value.trim(),selected=[...state.selected.values()],additional=manualNumbers();$('send-result').replaceChildren();
    if(!selected.length&&!additional.length){resultRow('Select at least one unit or contact.',true);return;}
    if(!text){resultRow('Write the message for the selected recipients.',true);$('send-text').focus();return;}
    if(selected.some(item=>!normalizePhone(item.number))){resultRow('Some selected recipients have no valid SIM or phone number. Review the highlighted selections first.',true);return;}
    if(additional.some(number=>!normalizePhone(number))){resultRow('Review the additional phone numbers before continuing.',true);return;}
    if(selectedPhones().length>100){resultRow('Choose up to 100 unique recipients per message.',true);return;}
    state.sending=true;sendButton.disabled=true;labelButton(sendButton,'activity','Simulating…');
    try{const data=await request('/api/sms/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({numbers:additional.join(','),text,channel:$('send-channel').value,targets:selected.map(({kind,id})=>({kind,id}))})});resultRow(`${data.sent} recipient${data.sent===1?'':'s'} accepted for local simulation${data.failed?`; ${data.failed} failed`:''}. No message was delivered.`);(data.results||[]).forEach(result=>resultRow(`${result.number} — ${result.success?'Simulated locally · not sent':result.error||'Unable to prepare this recipient'}`,!result.success));}catch(error){resultRow(error.message,true);}finally{state.sending=false;sendButton.disabled=false;labelButton(sendButton,'message-square','Simulate message');}
  };
  setSource('unit');refreshRecipients();
  // Preserve all existing IDs and select values used by the original local handlers.
  document.querySelectorAll('.panel label').forEach(label=>{const next=label.nextElementSibling;if(next?.matches('input,select,textarea')&&next.id)label.htmlFor=next.id;});
  labelButton(document.querySelector('.contact-form button'),'users','Save contact');
  labelButton(document.querySelector('.quota-settings-card h3'),'chart-column','Quota settings');
  labelButton(document.querySelector('.quota-last-msg-card h3'),'message-square','Latest submission');
  labelButton($('quota-save-btn'),'clipboard-check','Save settings');
  document.querySelector('.quota-settings-card label').textContent='Messages per cycle';
  document.querySelector('.ip-box').hidden=true;
  const overviewTitle=document.createElement('h3');overviewTitle.className='sm-overview-title';overviewTitle.append(icon('activity'),document.createTextNode('Usage this cycle'));document.querySelector('.quota-overview-card').prepend(overviewTitle);
  const wrapTables=()=>document.querySelectorAll('.panel table').forEach(table=>{if(table.parentElement.classList.contains('sm-table-scroll'))return;const scroller=document.createElement('div');scroller.className='sm-table-scroll';scroller.tabIndex=0;scroller.setAttribute('role','region');scroller.setAttribute('aria-label',table.closest('#panel-report')?'Message history':'Saved message data');table.before(scroller);scroller.append(table);table.querySelectorAll('th').forEach(th=>th.scope='col');});wrapTables();
  const loadReport=window.loadReport;window.loadReport=async()=>{await loadReport();document.querySelectorAll('#panel-report .status-badge').forEach(badge=>{if(badge.textContent.trim()==='simulated')badge.textContent='Local simulation · not sent';});};
  document.querySelectorAll('#panel-report .card .label')[1]?.replaceChildren(document.createTextNode('Local simulations'));
  const reportEmpty=$('report-empty');if(reportEmpty)reportEmpty.textContent='No local message attempts in this period.';
  document.querySelector('#panel-quota .quota-last-msg-card h3')?.replaceChildren(icon('message-square'),document.createTextNode('Latest local attempt'));
  const loadStatus=window.loadStatus;window.loadStatus=async()=>{await loadStatus();wrapTables();document.querySelectorAll('#status-last .status-badge').forEach(badge=>{if(badge.textContent.trim()==='simulated')badge.textContent='Local simulation · not sent';});};
  const statSymbols=['file-chart-column','clipboard-check','activity'];document.querySelectorAll('#panel-report .card').forEach((card,index)=>{const tile=icon(statSymbols[index]);tile.classList.add('sm-stat-icon');card.append(tile);});
  const filters=document.querySelector('.report-controls');labelButton(filters.querySelector('button'),'table-2','Apply filters');labelButton(filters.querySelector('.secondary-btn'),'arrow-left','Clear day');
  const oldExports=document.querySelector('.report-export-row');oldExports.replaceChildren();
  const languageField=document.createElement('div');languageField.className='sm-export-language';const languageLabel=document.createElement('label');languageLabel.textContent='Export language';languageLabel.htmlFor='sm-report-language';const language=document.createElement('select');language.id='sm-report-language';language.add(new Option('English','en'));language.add(new Option('العربية','ar'));languageField.append(languageLabel,language);oldExports.append(languageField);
  [['table-2','Excel','xlsx',false],['eye','View PDF','pdf',false],['file-text','Download PDF','pdf',true]].forEach(([symbol,title,format,download])=>{const button=document.createElement('button');button.type='button';button.className='sm-export-button';labelButton(button,symbol,title);button.addEventListener('click',()=>window.exportReport(format,language.value,download));oldExports.append(button);});
  // Raised scrollable menus keep native selects as the single source of form values.
  const menus=[];
  function closeMenus(except){menus.forEach(({wrap,trigger})=>{if(wrap!==except){wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');wrap.parentElement.classList.remove('sm-field-open');}});}
  const enhanceSelect=select=>{
    const wrap=document.createElement('div');wrap.className='sm-select';const trigger=document.createElement('button');trigger.type='button';trigger.className='sm-select-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const label=document.querySelector(`label[for="${select.id}"]`);if(label){label.id=`${select.id}-label`;trigger.setAttribute('aria-labelledby',label.id);}else trigger.setAttribute('aria-label',select.id);
    const menu=document.createElement('div');menu.className='sm-select-menu';menu.id=`${select.id}-menu`;trigger.setAttribute('aria-controls',menu.id);const list=document.createElement('div');list.className='sm-select-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',label?.textContent||'Options');
    let search=null;if(select.id==='send-unit-picker'){search=document.createElement('input');search.type='search';search.placeholder='Find a unit…';search.setAttribute('aria-label','Search units');menu.append(search);}menu.append(list);
    select.before(wrap);wrap.append(select,trigger,menu);select.hidden=true;select.tabIndex=-1;select.classList.add('sm-native-select');
    const close=()=>{wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');wrap.parentElement.classList.remove('sm-field-open');};
    const sync=()=>{trigger.textContent=select.selectedOptions[0]?.textContent.trim()||'Choose';trigger.disabled=select.disabled;[...list.children].forEach(option=>option.setAttribute('aria-selected',String(option.dataset.value===select.value)));if(['send-channel','send-unit-picker'].includes(select.id))updatePreview();};
    const filter=()=>{if(search)list.querySelectorAll('button').forEach(option=>option.hidden=!option.textContent.toLowerCase().includes(search.value.trim().toLowerCase()));};
    const refresh=()=>{const seen=new Set();[...select.options].forEach(option=>{if(seen.has(option.value))option.remove();else seen.add(option.value);});list.replaceChildren();[...select.options].forEach(option=>{const button=document.createElement('button');button.type='button';button.className='sm-select-option';button.dataset.value=option.value;button.textContent=option.textContent.trim();button.setAttribute('role','option');button.disabled=option.disabled;button.addEventListener('click',()=>{select.value=option.value;sync();select.dispatchEvent(new Event('change',{bubbles:true}));close();trigger.focus();});list.append(button);});sync();filter();};
    const open=()=>{closeMenus(wrap);wrap.classList.add('is-open');trigger.setAttribute('aria-expanded','true');wrap.parentElement.classList.add('sm-field-open');};
    const options=()=>[...list.querySelectorAll('button:not([hidden]):not(:disabled)')];
    trigger.addEventListener('click',()=>wrap.classList.contains('is-open')?close():open());
    trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();const values=options();(event.key==='ArrowUp'?values.at(-1):values.find(value=>value.dataset.value===select.value)||values[0])?.focus();}});
    wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){close();trigger.focus();event.preventDefault();}if(event.key==='Tab')close();if(list.contains(event.target)&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const values=options(),index=values.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?values.length-1:(index+(event.key==='ArrowDown'?1:-1)+values.length)%values.length;values[next]?.focus();}});
    search?.addEventListener('input',filter);select.addEventListener('change',sync);new MutationObserver(refresh).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});menus.push({wrap,trigger});refresh();
  };
  document.querySelectorAll('.panel select:not([hidden])').forEach(enhanceSelect);document.addEventListener('click',event=>{if(!event.target.closest('.sm-select'))closeMenus();});
  updatePreview();
})();
