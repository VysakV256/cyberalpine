/* Dataset selection controls for the source-driven landscape generator. */
const shortNames={'bls-cpi':'CPI','bls-unemployment':'Unemployment','economic-observations':'Observation objects','research-crossref':'Research','books-crossref':'Books','crossref-reference-edges':'DOI references'};
const forms=new Set(['auto','peak','forest']);
const nativeName=dataset=>dataset.form==='peak'?'Mountain peak':dataset.form==='foothill'?'Wooded foothill':'Pine forest';
const make=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element};
const signature=selections=>JSON.stringify(selections);
const count=value=>new Intl.NumberFormat('en-US').format(value);

export function createLandscapeBuilder({manifest,onGenerate=()=>{}}={}){
 const mount=document.getElementById('landscapeBuilder');if(!mount)throw Error('Missing #landscapeBuilder.');
 const datasets=Array.isArray(manifest?.datasets)?manifest.datasets:[];
 if(!datasets.length){mount.replaceChildren(make('p','builder-empty','Source datasets are not available yet.'));return{setSelection(){},setStatus(){},getSelection(){return[]}};}
 const rows=new Map();let state='ready',appliedSignature='',statusText='',isGenerating=false;
 const form=make('form','builder-form');
 const heading=make('div','builder-heading'),intro=make('div','builder-intro');
 intro.append(make('span','eyebrow','COMPOSE YOUR LANDSCAPE'),make('h3','','Give your data a place.'));
 const description=make('p','builder-description','Choose the datasets to explore, then grow a new range. Each selection becomes its own peak, wooded foothill or forest.');
 heading.append(intro,description);
 const fieldset=make('fieldset','builder-datasets');fieldset.append(make('legend','builder-sr-only','Datasets and landscape forms'));
 for(const dataset of datasets){
  const row=make('div','builder-dataset'),checkLabel=make('label','builder-check'),checkbox=make('input');checkbox.type='checkbox';checkbox.name='datasets';checkbox.value=dataset.id;checkbox.checked=true;
  const symbol=make('span','builder-symbol',dataset.form==='peak'?'△':dataset.form==='foothill'?'◇':'♧');symbol.setAttribute('aria-hidden','true');
  const text=make('span','builder-dataset-copy'),title=make('strong','',shortNames[dataset.id]||dataset.name||dataset.id);
  const total=dataset.records?.length||0;let unit=dataset.derived?(dataset.structure==='relational'?'derived reference edges':'derived objects'):(dataset.structure==='tabular'?'source observations':'source records');
  text.append(title,make('small','',`${count(total)} ${unit}`));checkLabel.append(checkbox,symbol,text);
  const selectLabel=make('label','builder-form-label'),select=make('select','builder-form-select');select.name=`form-${dataset.id}`;select.setAttribute('aria-label',`${shortNames[dataset.id]||dataset.name} landscape form`);
  selectLabel.append(make('span','builder-sr-only',`${shortNames[dataset.id]||dataset.name} landscape form`));
  for(const[value,label]of[['auto',`Native · ${nativeName(dataset)}`],['peak','Mountain peak'],['forest','Pine forest']]){const option=make('option','',label);option.value=value;select.append(option)}
  selectLabel.append(select);row.append(checkLabel,selectLabel);fieldset.append(row);rows.set(dataset.id,{checkbox,select,row});
  checkbox.addEventListener('change',selectionChanged);select.addEventListener('change',selectionChanged);
 }
 const toolbar=make('div','builder-toolbar'),presets=make('div','builder-selection-tools');presets.setAttribute('role','group');presets.setAttribute('aria-label','Dataset selection shortcuts');
 const all=make('button','builder-text-button','Select all'),clear=make('button','builder-text-button','Clear');all.type=clear.type='button';
 presets.append(all,clear);const selectedCount=make('span','builder-selection-count');
 const generate=make('button','builder-generate');generate.type='submit';generate.append(make('span','','Generate landscape'),make('span','builder-generate-arrow','↗'));generate.lastChild.setAttribute('aria-hidden','true');
 toolbar.append(presets,selectedCount,generate);
 const bottom=make('div','builder-bottom'),note=make('p','builder-mapping-note','Native forms follow source structure. Forests show up to 150 record trees per dataset. Relief and canopy sizes use display scales; exact values stay in the Data lens.');
 const status=make('p','builder-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');bottom.append(note,status);
 form.append(heading,fieldset,toolbar,bottom);mount.replaceChildren(form);mount.classList.add('landscape-builder');
 appliedSignature=signature(getSelection());statusText=`Full landscape ready · ${datasets.length} dataset homes`;render();
 all.addEventListener('click',()=>{for(const row of rows.values())row.checkbox.checked=true;selectionChanged()});
 clear.addEventListener('click',()=>{for(const row of rows.values())row.checkbox.checked=false;selectionChanged()});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(isGenerating||!getSelection().length)return;
  const selected=getSelection();setStatus({state:'generating',message:'Growing your selected dataset landscape…'});
  try{const result=await onGenerate(selected);if(isGenerating)setStatus({state:'ready',summary:result?.summary});}
  catch(error){setStatus({state:'error',message:error?.message||'The landscape could not be generated. Try again.'});console.error('Cyberalpine landscape generation failed:',error);}
 });
 function getSelection(){return datasets.filter(dataset=>rows.get(dataset.id).checkbox.checked).map(dataset=>({datasetId:dataset.id,form:rows.get(dataset.id).select.value}));}
 function render(){
  const selected=getSelection(),pending=signature(selected)!==appliedSignature;
  mount.dataset.state=state;mount.setAttribute('aria-busy',String(isGenerating));selectedCount.textContent=`${selected.length} / ${datasets.length} selected`;
  generate.disabled=isGenerating||!selected.length;generate.firstChild.textContent=isGenerating?'Generating…':'Generate landscape';all.disabled=clear.disabled=isGenerating;
  for(const{checkbox,select,row}of rows.values()){checkbox.disabled=isGenerating;select.disabled=isGenerating||!checkbox.checked;row.classList.toggle('is-selected',checkbox.checked)}
  status.classList.toggle('is-pending',pending&&!isGenerating&&state!=='error');
  status.textContent=state==='error'||isGenerating?statusText:!selected.length?'Choose at least one dataset to generate a landscape.':pending?'Selection changed · Generate to update the landscape.':statusText;
 }
 function selectionChanged(){if(state==='error'){state='ready';statusText='Your previous landscape is still in view.'}render();}
 function setSelection(selections){
  if(!Array.isArray(selections))throw TypeError('Landscape selections must be an array.');
  const requested=new Map();for(const entry of selections){if(!rows.has(entry?.datasetId))throw TypeError(`Unknown dataset: ${entry?.datasetId}`);if(!forms.has(entry.form))throw TypeError(`Unknown landscape form: ${entry.form}`);if(requested.has(entry.datasetId))throw TypeError(`Duplicate dataset: ${entry.datasetId}`);requested.set(entry.datasetId,entry.form)}
  for(const[id,row]of rows){row.checkbox.checked=requested.has(id);row.select.value=requested.get(id)||'auto'}selectionChanged();
 }
 function setStatus({state:nextState='ready',message,summary}={}){
  if(!['generating','ready','error'].includes(nextState))throw TypeError(`Unknown builder state: ${nextState}`);
  state=nextState;isGenerating=state==='generating';
  if(state==='ready')appliedSignature=signature(getSelection());
  const units={datasetCount:['dataset home','dataset homes'],peakCount:['peak','peaks'],forestCount:['forest','forests'],treeCount:['record tree','record trees'],sourceRecordCount:['source record','source records'],derivedRecordCount:['derived record','derived records']};
  const summaryText=typeof summary==='string'?summary:summary&&typeof summary==='object'?Object.entries(summary).filter(([,value])=>typeof value==='number'||typeof value==='string').map(([key,value])=>`${typeof value==='number'?count(value):value} ${units[key]?.[value===1?0:1]||key.replace(/([A-Z])/g,' $1').toLowerCase()}`).join(' · '):'';
  statusText=message||summaryText||(state==='generating'?'Growing your selected dataset landscape…':state==='error'?'The landscape could not be generated. Try again.':`Landscape ready · ${getSelection().length} dataset homes`);render();
 }
 return{setSelection,setStatus,getSelection};
}
