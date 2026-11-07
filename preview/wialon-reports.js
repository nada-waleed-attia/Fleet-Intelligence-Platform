// EDIT BY NADA — Wialon report presentation within the existing isolated preview.
(() => {
  const $ = id => document.getElementById(id);
  const icon = name => { const node=document.createElement('span');node.className='wr-icon';node.setAttribute('aria-hidden','true');node.innerHTML=ObserverIcons.svg(name);return node; };
  const labelButton=(node,symbol,label)=>{const text=document.createElement('span');text.textContent=label;node.replaceChildren(icon(symbol),text);};
  const backdrop=document.createElement('div');backdrop.className='wr-backdrop';backdrop.setAttribute('aria-hidden','true');
  backdrop.innerHTML='<div class="wr-glow wr-glow-green"></div><div class="wr-glow wr-glow-gold"></div><div class="wr-contours"></div><div class="wr-grid-floor"></div>';document.body.prepend(backdrop);
  const page=document.createElement('main');page.className='wr-page';
  const header=document.querySelector('.header'),panel=document.querySelector('.panel');header.before(page);page.append(header,panel);
  labelButton(document.querySelector('.back-btn'),'arrow-left','Dashboard');
  const eyebrow=document.createElement('div');eyebrow.className='wr-eyebrow';eyebrow.textContent='OBSERVER FLEET';document.querySelector('.brand-text').prepend(eyebrow);
  document.querySelector('.brand-subtitle').textContent='Fleet reporting workspace';panel.querySelector(':scope > .hint')?.remove();
  const heading=document.createElement('div');heading.className='wr-builder-heading';
  const headingCopy=document.createElement('div'),title=document.createElement('h2'),intro=document.createElement('p');
  title.append(icon('file-chart-column'),document.createTextNode('Build your report'));intro.textContent='Choose a template, units and a date range.';headingCopy.append(title,intro);
  const art=document.createElement('div');art.className='wr-paper-art';art.setAttribute('aria-hidden','true');art.innerHTML='<span class="wr-sheet wr-sheet-back"></span><span class="wr-sheet wr-sheet-middle"></span><span class="wr-sheet wr-sheet-front"></span>';art.lastChild.append(icon('chart-column'));heading.append(headingCopy,art);panel.prepend(heading);
  const fieldData=[['template-select','Report template','file-chart-column'],['units-selected-text','Units','truck'],['date-from','From','activity'],['date-to','To','activity']];
  [...panel.querySelectorAll('.field-grid > .field')].forEach((field,index)=>{const[id,label,symbol]=fieldData[index];field.style.setProperty('--field-delay',`${80+index*60}ms`);const caption=field.querySelector(':scope > label');caption.id=`wr-field-label-${index}`;caption.replaceChildren(icon(symbol),document.createTextNode(label));if(id!=='units-selected-text'){caption.htmlFor=id;$(id).setAttribute('aria-labelledby',caption.id);}});
  const runButton=document.querySelector('.run-btn');labelButton(runButton,'activity','Run report');
  const runRow=document.createElement('div');runRow.className='wr-run-row';runButton.before(runRow);runRow.append(runButton);
  const runHint=document.createElement('p');runHint.textContent='Results use the selected template and period.';runRow.append(runHint);
  // A single language selector serves all existing export paths.
  const results=document.createElement('section');results.className='wr-results-panel';results.setAttribute('aria-label','Report results');
  const resultsHeader=document.createElement('div');resultsHeader.className='wr-results-header';
  const resultHeading=document.createElement('div');resultHeading.innerHTML='<h2>Report results</h2><p id="wr-result-summary" role="status">Ready when you are</p>';
  const exports=document.createElement('div');exports.className='wr-exports';
  const languageLabel=document.createElement('label');languageLabel.className='wr-language';
  const languageCaption=document.createElement('span');languageCaption.className='wr-language-label';languageCaption.textContent='Report language';
  const language=document.createElement('select');language.id='wr-export-language';language.setAttribute('aria-label','Report language');language.add(new Option('English','en'));language.add(new Option('العربية','ar'));languageLabel.append(languageCaption,language);exports.append(languageLabel);
  const exportButtons=[['table-2','Excel','xlsx',false],['eye','View PDF','pdf',false],['file-text','Download PDF','pdf',true]].map(([symbol,label,format,download])=>{const button=document.createElement('button');button.type='button';button.className='wr-export-button';button.disabled=true;labelButton(button,symbol,label);button.addEventListener('click',()=>window.exportReport(format,language.value,download));exports.append(button);return button;});
  document.querySelector('.export-row').remove();const area=$('result-area');resultsHeader.append(resultHeading,exports);results.append(resultsHeader,area);page.append(results);
  // Preserve native values for existing queries; expose a keyboard accessible raised menu.
  const menus=[];
  const closeTemplateMenus=except=>menus.forEach(({wrap,trigger})=>{if(wrap!==except){wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');wrap.closest('.field')?.classList.remove('wr-field-open');}});
  const enhanceSelect=select=>{
    const wrap=document.createElement('div');wrap.className='wr-select';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='wr-select-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label',select.getAttribute('aria-label')||'Report template');
    const menu=document.createElement('div');menu.className='wr-select-menu';menu.id=`${select.id}-options`;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',select.getAttribute('aria-label')||'Report template');trigger.setAttribute('aria-controls',menu.id);
    select.before(wrap);wrap.append(select,trigger,menu);select.hidden=true;select.tabIndex=-1;select.classList.add('wr-native-select');
    const close=()=>{wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');wrap.closest('.field')?.classList.remove('wr-field-open');};
    const options=()=>[...menu.querySelectorAll('button:not(:disabled)')];
    const sync=()=>{trigger.textContent=select.options[select.selectedIndex]?.textContent.trim()||'Choose a template';[...menu.children].forEach(node=>node.setAttribute('aria-selected',String(node.dataset.value===select.value)));};
    const refresh=()=>{menu.replaceChildren();[...select.options].forEach(option=>{const item=document.createElement('button');item.type='button';item.className='wr-select-option';item.dataset.value=option.value;item.setAttribute('role','option');item.textContent=option.textContent.trim();item.disabled=option.disabled||!option.value;item.addEventListener('click',()=>{select.value=option.value;sync();select.dispatchEvent(new Event('change',{bubbles:true}));close();trigger.focus();});menu.append(item);});sync();};
    const open=()=>{closeTemplateMenus(wrap);$('units-menu').classList.remove('show');wrap.classList.add('is-open');trigger.setAttribute('aria-expanded','true');wrap.closest('.field')?.classList.add('wr-field-open');};
    trigger.addEventListener('click',()=>wrap.classList.contains('is-open')?close():open());
    trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();const items=options();(event.key==='ArrowUp'?items.at(-1):items.find(item=>item.dataset.value===select.value)||items[0])?.focus();}});
    wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){close();trigger.focus();event.preventDefault();}if(event.key==='Tab')close();if(menu.contains(event.target)&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=options(),current=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}});
    select.addEventListener('change',sync);new MutationObserver(refresh).observe(select,{childList:true,subtree:true});menus.push({wrap,trigger});refresh();
  };
  enhanceSelect($('template-select'));enhanceSelect(language);
  document.addEventListener('click',event=>{if(!event.target.closest('.wr-select'))closeTemplateMenus();});
  const unitsTrigger=document.querySelector('.units-dropdown-button');unitsTrigger.type='button';unitsTrigger.setAttribute('aria-label','Choose units');unitsTrigger.setAttribute('aria-controls','units-menu');unitsTrigger.setAttribute('aria-expanded','false');unitsTrigger.querySelector('.arrow').replaceChildren(icon('chevron-right'));unitsTrigger.addEventListener('click',()=>closeTemplateMenus());
  const unitsMenu=$('units-menu');new MutationObserver(()=>{const open=unitsMenu.classList.contains('show');unitsTrigger.setAttribute('aria-expanded',String(open));unitsTrigger.closest('.field').classList.toggle('wr-field-open',open);}).observe(unitsMenu,{attributes:true,attributeFilter:['class']});
  const search=document.createElement('input');search.type='search';search.className='wr-unit-search';search.placeholder='Find a unit…';search.setAttribute('aria-label','Search available units');unitsMenu.prepend(search);
  search.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();$('units-list').querySelectorAll('.unit-option').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(query));});
  unitsMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){unitsMenu.classList.remove('show');unitsTrigger.focus();}});
  let generated=false, latestResults=null;
  document.querySelector('.field-grid').addEventListener('change',()=>{if(generated){exportButtons.forEach(button=>button.disabled=true);$('wr-result-summary').textContent='Settings changed · run the report to update results';}});
  const decorateResults=()=>{
    const blocks=[...area.querySelectorAll('.unit-block')];blocks.forEach((block,index)=>{if(block.dataset.styled)return;block.dataset.styled='true';block.style.setProperty('--result-delay',`${Math.min(index,8)*45}ms`);block.querySelector('.unit-title')?.prepend(icon('truck'));block.querySelectorAll('table').forEach(table=>{const scroller=document.createElement('div');scroller.className='wr-table-scroll';scroller.tabIndex=0;scroller.setAttribute('role','region');scroller.setAttribute('aria-label','Report table');table.before(scroller);scroller.append(table);table.querySelectorAll('th').forEach(th=>th.scope='col');});});
    if(area.querySelector('.error-msg')){exportButtons.forEach(button=>button.disabled=true);$('wr-result-summary').textContent='Check the report settings';}
    const empty=area.querySelector(':scope > .empty-msg');if(empty&&!area.querySelector('.wr-empty')){const initial=/Select a template/.test(empty.textContent),state=document.createElement('div');state.className='wr-empty';const title=document.createElement('h3'),text=document.createElement('p');title.textContent=initial?'Your report will appear here':'No results for this selection';text.textContent=initial?'Choose your settings above, then run the report.':'Try a different template, unit selection or date range.';state.append(icon('file-chart-column'),title,text);empty.replaceWith(state);}
  };
  new MutationObserver(decorateResults).observe(area,{childList:true});
  const renderResults=window.renderResults;
  const displayResults=()=>{
    const lang=language.value, records=latestResults||[], count=records.length;
    area.dir=lang==='ar'?'rtl':'ltr';area.lang=lang;
    renderResults(ObserverReportLanguage.results(records,lang));
    $('wr-result-summary').textContent=lang==='ar'?`عدد الوحدات في التقرير: ${count}`:`${count} unit${count===1?'':'s'} in this report`;
    decorateResults();
    if(lang==='ar'){
      area.querySelectorAll('.empty-msg').forEach(node=>node.textContent='لا توجد بيانات خلال الفترة المحددة');
      const empty=area.querySelector('.wr-empty');
      if(empty){empty.querySelector('h3').textContent='لا توجد نتائج لهذا الاختيار';empty.querySelector('p').textContent='جرّبي قالبًا أو وحدات أو فترة زمنية مختلفة.';}
    }
  };
  window.renderResults=records=>{generated=true;latestResults=Array.isArray(records)?records:[];exportButtons.forEach(button=>button.disabled=!latestResults.length);displayResults();};
  language.addEventListener('change',()=>{if(latestResults!==null)displayResults();});
  const runReport=window.runReport;window.runReport=async(...args)=>{exportButtons.forEach(button=>button.disabled=true);closeTemplateMenus();unitsMenu.classList.remove('show');const promise=runReport(...args);if(runButton.disabled){labelButton(runButton,'activity','Running report…');$('wr-result-summary').textContent='Generating report…';}try{return await promise;}finally{labelButton(runButton,'activity','Run report');}};
  decorateResults();
})();
