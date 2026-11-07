// Presentation enhancements. Existing form, permission and report handlers remain active.
(() => {
  const admin = document.body.dataset.previewPage === 'admin-users.html';
  // Canonical Lucide paths, matching the icons distributed with lucide-react.
  const extra={x:'<path d="M18 6 6 18M6 6l12 12"/>','trash-2':'<path d="M3 6h18M10 11v6M14 11v6M5 6l1 14h12l1-14M9 6V3h6v3"/>','chevron-down':'<path d="m6 9 6 6 6-6"/>'};
  const svg = name => extra[name]?'<svg class="observer-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+extra[name]+'</svg>':ObserverIcons.svg(name);
  const make = (tag, cls, text) => { const node=document.createElement(tag);node.className=cls;if(text)node.textContent=text;return node; };
  const selectMenus=[];
  const closeSelectMenus=except=>selectMenus.forEach(menu=>{if(menu!==except)menu.open=false;});
  const enhanceSelect=select=>{
    if(!select||select.dataset.select3d)return;
    select.dataset.select3d='true';select.classList.add('op-native-select');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const details=make('details','observer-select'),summary=make('summary','observer-select-trigger'),list=make('div','observer-select-menu');
    const label=select.closest('.field,.op-filter-field,.op-role,.form-grid>div')?.querySelector('label,span')?.textContent.trim()||'Choose an option';
    summary.setAttribute('aria-label',label);list.setAttribute('role','listbox');select.before(details);details.append(summary,list,select);selectMenus.push(details);
    const render=()=>{
      const selected=select.selectedOptions[0];summary.replaceChildren(document.createTextNode(selected?.textContent.trim()||'Choose an option'));
      summary.insertAdjacentHTML('beforeend',svg('chevron-down'));details.classList.toggle('is-disabled',select.disabled);summary.tabIndex=select.disabled?-1:0;summary.setAttribute('aria-disabled',String(select.disabled));list.replaceChildren();
      [...select.options].forEach(option=>{const button=make('button','observer-select-option',option.textContent.trim());button.type='button';button.dataset.value=option.value;button.disabled=option.disabled;button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.value===select.value));if(option.value===select.value)button.classList.add('is-selected');button.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));details.open=false;render();summary.focus();});list.append(button);});
    };
    details.addEventListener('toggle',()=>{if(details.open){closeSelectMenus(details);requestAnimationFrame(()=>list.querySelector('.is-selected:not(:disabled),button:not(:disabled)')?.focus());}});
    summary.addEventListener('click',event=>{if(select.disabled){event.preventDefault();details.open=false;}});
    summary.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)&&!select.disabled){event.preventDefault();details.open=true;requestAnimationFrame(()=>list.querySelector(event.key==='ArrowUp'?'button:not(:disabled):last-child':'.is-selected:not(:disabled),button:not(:disabled)')?.focus());}});
    list.addEventListener('keydown',event=>{const items=[...list.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);if(event.key==='Escape'){details.open=false;summary.focus();event.preventDefault();}else if(event.key==='ArrowDown'){items[(index+1)%items.length]?.focus();event.preventDefault();}else if(event.key==='ArrowUp'){items[(index-1+items.length)%items.length]?.focus();event.preventDefault();}});
    select.addEventListener('change',render);select.addEventListener('invalid',event=>{event.preventDefault();summary.focus();});new MutationObserver(render).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','label']});select._select3dSync=render;render();
  };
  const enhanceOperationSelects=()=>document.querySelectorAll(admin?'#f-role,#op-role-filter':'#filter-company,#f-company,.vehicle-unit-select').forEach(enhanceSelect);
  document.documentElement.lang='en';document.documentElement.dir='ltr';
  document.title=admin?'Observer · Manage Users & Reports':'Observer · Maintenance Reports';
  const backdrop=make('div','op-backdrop');backdrop.setAttribute('aria-hidden','true');backdrop.innerHTML='<div class="op-glow green"></div><div class="op-glow gold"></div><div class="op-contours"></div><div class="op-grid"></div>';document.body.prepend(backdrop);
  const page=make('main','op-page');
  const header=document.querySelector(admin?'.header':'header');header.before(page);page.append(header);
  const art=()=>'<div class="op-art" aria-hidden="true"><div class="op-orbit"></div><div class="op-tile">'+svg(admin?'users':'wrench')+'</div><span class="op-float">'+svg(admin?'file-chart-column':'clipboard-check')+'</span><span class="op-float small">'+svg(admin?'layout-dashboard':'truck')+'</span></div>';
  const hero=make('section','op-hero');
  if(admin){
    document.querySelectorAll('body > .panel').forEach(node=>page.append(node));
    header.after(hero);hero.innerHTML='<div class="op-hero-copy"><div class="op-eyebrow">OBSERVER · ACCESS & REPORTING</div><h2>The right access.<br>For every team.</h2><p>Manage users, assign fleet units and choose the screens and reports each person can access.</p><button type="button" class="op-primary" id="op-new-user">'+svg('users')+'Create new user</button></div>'+art();
    header.querySelector('.header-actions button:not(.back-btn)')?.remove();
    const create=document.getElementById('create-form').closest('.panel');
    const disclosure=make('details','op-create');const summary=make('summary','');summary.innerHTML=svg('users')+'<span>Create new user<small>Account details, assigned units and screen permissions</small></span>'+svg('chevron-right');disclosure.append(summary);create.before(disclosure);disclosure.append(create);create.querySelector('h2').remove();
    document.getElementById('op-new-user').addEventListener('click',()=>{disclosure.open=true;disclosure.scrollIntoView({behavior:'smooth',block:'start'});document.getElementById('f-username').focus({preventScroll:true});});
    const modeHint=document.getElementById('f-authmode').parentElement.querySelector('.hint');modeHint.textContent='Wialon users sign in through Wialon and see the units available to their account.';
    const accounts=document.getElementById('f-wialonaccounts');accounts.parentElement.querySelector('.hint').textContent='Optional account names used as a fallback for unit assignment.';
    const permissions=document.querySelector('#create-form .perm-section');permissions.querySelector('.perm-title span').textContent='Choose the screens available to this user. Admins have full access.';
    const form=document.getElementById('create-form');form.querySelectorAll('.form-grid > div > label').forEach((label,index)=>{const control=label.parentElement.querySelector('input,select');if(control)label.htmlFor=control.id;label.parentElement.style.setProperty('--op-order',index);});
    const directory=document.getElementById('users-tbody').closest('.panel');directory.classList.add('op-directory');directory.querySelector('h2').textContent='User directory';
    const tools=make('div','op-directory-tools');tools.innerHTML='<label class="op-search">'+svg('eye')+'<input id="op-user-search" type="search" placeholder="Search username or display name…" aria-label="Search users"></label><label class="op-role">Role<select id="op-role-filter"><option value="">All roles</option><option value="admin">Admin</option><option value="customer">Customer</option></select></label><span id="op-user-count" role="status"></span>';
    directory.querySelector('.table-wrap').before(tools);directory.querySelector('table').classList.add('op-user-table');
    const empty=make('p','op-no-users','No users match your search.');empty.hidden=true;directory.append(empty);
    const applyFilter=()=>{let count=0;document.querySelectorAll('#users-tbody tr').forEach(row=>{if(row.cells.length<7)return;const name=(row.cells[0].textContent+' '+row.cells[1].textContent).toLowerCase(),role=row.querySelector('.role-badge')?.textContent.trim();row.hidden=!(name.includes(document.getElementById('op-user-search').value.trim().toLowerCase())&&(!document.getElementById('op-role-filter').value||role===document.getElementById('op-role-filter').value));if(!row.hidden)count++;});document.getElementById('op-user-count').textContent=count+' users';empty.hidden=count!==0;};
    document.getElementById('op-user-search').addEventListener('input',applyFilter);document.getElementById('op-role-filter').addEventListener('change',applyFilter);
    const decorateUsers=()=>{
      const labels=['Username','Display name','Role','Assigned units','Report email','Screen permissions','Actions'];
      document.querySelectorAll('#users-tbody tr').forEach((row,index)=>{
        if(row.cells.length<7)return;row.style.setProperty('--op-order',Math.min(index,8));
        [...row.cells].forEach((cell,i)=>{cell.dataset.label=labels[i];});
        const perms=row.cells[5],permGrid=perms.querySelector('.perm-grid');
        if(permGrid&&!perms.querySelector('details')){const details=make('details','op-permission-details');const title=make('summary','','Manage screen permissions');details.append(title);while(perms.firstChild)details.append(perms.firstChild);perms.append(details);}
        const token=row.cells[3].querySelector('[id^="wtoken-"]');
        if(token&&!row.cells[3].querySelector('.op-import')){const block=token.closest('.email-cell'),details=make('details','op-import');details.append(make('summary','','Import units from Wialon'));block.before(details);details.append(block);}
        row.querySelectorAll('button').forEach(button=>button.classList.add('op-small-action'));
      });
      applyFilter();decorateButtons();
    };
    const usersObserver=new MutationObserver(()=>decorateUsers());usersObserver.observe(document.getElementById('users-tbody'),{childList:true});decorateUsers();
  }else{
    const container=document.querySelector('.container');page.append(container);
    document.querySelector('.brand h1').textContent='Maintenance Reports';
    const top=document.querySelector('.top');top.classList.add('op-hero');const content=top.querySelector('.hero-content');content.classList.add('op-hero-copy');content.querySelector('h2').innerHTML='Every replacement.<br>Fully recorded.';
    content.querySelector('.eyebrow').textContent='FIELD SERVICE · DEVICE HISTORY';content.append(top.querySelector('.new-btn'));top.insertAdjacentHTML('beforeend',art());
    const listHeading=make('div','op-list-heading');listHeading.innerHTML='<h2>Maintenance history</h2><span id="op-report-count" role="status"></span>';document.querySelector('.filters').before(listHeading);
    const labels=[['filter-company','Company'],['filter-search','Search reports'],['filter-date-from','From date'],['filter-date-to','To date']];
    labels.forEach(([id,text])=>{const input=document.getElementById(id),label=make('label','op-filter-field');label.append(make('span','',text));input.before(label);label.append(input);});
    document.querySelector('.brand-mark').classList.add('op-logo');
    const signature=document.getElementById('preview-signature');if(signature){const block=signature.closest('.preview-controls');block.className='op-signature';block.querySelector('label').firstChild.textContent='Electronic signature (optional)';block.querySelector('button').textContent='Clear signature';document.getElementById('submit-btn').before(block);}
    const modal=document.getElementById('report-modal');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','op-modal-title');modal.querySelector('h3').id='op-modal-title';modal.querySelector('.close-btn').setAttribute('aria-label','Close report form');
    const close=window.closeNewReportModal;window.closeNewReportModal=(...args)=>{close(...args);document.body.classList.remove('op-modal-open');document.querySelector('.new-btn').focus();};
    const open=window.openNewReportModal;window.openNewReportModal=(...args)=>{open(...args);document.body.classList.add('op-modal-open');decorateButtons();};
    window.openScanModal=async button=>{const input=button.closest('.vehicle-row').querySelector('.vehicle-imei');const value=await ObserverPreview.call('scan');if(value)input.value=value;};
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&event.target.closest('.observer-select[open]'))return;if(event.key==='Escape'&&modal.style.display==='block')window.closeNewReportModal();});
    const reportObserver=new MutationObserver(()=>{document.querySelectorAll('.report-card').forEach((card,i)=>card.style.setProperty('--op-order',Math.min(i,8)));document.getElementById('op-report-count').textContent=document.querySelectorAll('.report-card').length+' reports';decorateButtons();});reportObserver.observe(document.getElementById('reports-list'),{childList:true});
    const vehicleObserver=new MutationObserver(()=>{decorateButtons();enhanceOperationSelects();});vehicleObserver.observe(document.getElementById('vehicle-rows'),{childList:true});
    document.querySelectorAll('.report-card').forEach((card,i)=>card.style.setProperty('--op-order',i));document.getElementById('op-report-count').textContent=document.querySelectorAll('.report-card').length+' reports';
    document.querySelectorAll('.field label').forEach(label=>{const control=label.parentElement.querySelector('[id]');if(control)label.htmlFor=control.id;});
  }
  document.addEventListener('click',event=>{if(!event.target.closest('.observer-select'))closeSelectMenus();});
  document.addEventListener('reset',()=>setTimeout(()=>document.querySelectorAll('.op-native-select').forEach(select=>select._select3dSync?.()),0),true);
  enhanceOperationSelects();
  function decorateReportDownloads(){
    if(admin)return;
    document.querySelectorAll('.report-actions').forEach(actions=>{
      const buttons=[...actions.querySelectorAll('.btn-pdf')],view=buttons[0],download=buttons[1];
      if(view&&!view.dataset.reportView){view.dataset.reportView='true';view.classList.add('op-report-view');view.replaceChildren();view.insertAdjacentHTML('afterbegin',svg('eye'));view.append(document.createTextNode('View report'));}
      if(!download||download.dataset.reportDownload)return;
      const source=download.getAttribute('onclick')||'',path=source.match(/['"](\/api\/maintenance-reports\/[^'"]+\/pdf[^'"]*)['"]/)?.[1];if(!path)return;
      download.dataset.reportDownload='true';download.removeAttribute('onclick');download.onclick=null;download.classList.add('op-download-pdf');download.replaceChildren();download.insertAdjacentHTML('afterbegin',svg('file-text'));download.append(document.createTextNode('Download PDF'));
      download.addEventListener('click',async()=>{download.disabled=true;try{await ObserverPreview.call('report-download',{path,format:'pdf'});}catch(error){ObserverPreview.alert(error.message);}finally{download.disabled=false;}});
      const word=make('button','btn-sm op-download-word');word.type='button';word.insertAdjacentHTML('afterbegin',svg('file-text'));word.append(document.createTextNode('Download Word'));word.addEventListener('click',async()=>{word.disabled=true;try{await ObserverPreview.call('report-download',{path,format:'word'});}catch(error){ObserverPreview.alert(error.message);}finally{word.disabled=false;}});actions.insertBefore(word,actions.querySelector('.btn-del'));
    });
  }
  function decorateButtons(){
    decorateReportDownloads();
    document.querySelectorAll('.empty-icon').forEach(node=>{if(!node.querySelector('svg'))node.innerHTML=svg('clipboard-list');});
    document.querySelectorAll('button').forEach(button=>{if(button.querySelector('svg'))return;if(button.classList.contains('close-btn')){button.innerHTML=svg('x');return;}button.querySelector('.plus')?.remove();const text=button.textContent.trim(),action=button.getAttribute('onclick')||'';let name=action.includes('delete')?'trash-2':text.includes('Remove')?'x':text.includes('Dashboard')?'arrow-left':text.includes('Scan')?'eye':text.includes('PDF')?'file-text':text.includes('Refresh')?'activity':text.includes('vehicle')?'truck':text.includes('User')?'users':text.includes('Permissions')?'layout-dashboard':text.includes('Report')||text.includes('report')?'clipboard-check':null;if(name){button.childNodes.forEach(node=>{if(node.nodeType===3)node.textContent=node.textContent.replace('←','');});button.insertAdjacentHTML('afterbegin',svg(name));}});
    document.querySelectorAll('.swap-arrow').forEach(node=>{if(!node.querySelector('svg'))node.innerHTML=svg('chevron-right');});
  }
  decorateButtons();
})();
