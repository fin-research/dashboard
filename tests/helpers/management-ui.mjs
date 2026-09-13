import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDom, loadComponent } from './svelte-dom.mjs';
const window = installDom();
const { mount, unmount, flushSync, tick } = await import('svelte');
const { globalMessages } = await import('../../src/lib/global-messages.ts');
const { PERMISSION_CODES } = await import('../../src/lib/permissions.ts');
globalThis.fetch = async () => Response.json({user:null,account:null});
const Page = await loadComponent('src/routes/management/people/+page.svelte', (await readFile(new URL('../../src/routes/management/people/+page.svelte',import.meta.url),'utf8')).replace("import { invalidate } from '$app/navigation';", "const invalidate=async()=>{};"));
const app = mount(Page,{target:document.body,props:{data:{roles:[{id:'rol_A',name:'测试管理员',description:''},{id:'rol_B',name:'测试成员',description:''}],configurations:{rol_A:{permissions:[PERMISSION_CODES[0]]},rol_B:{permissions:[]}},permissions:['auth.permission:update'],updatedAt:Date.now(),mode:'enforce'}}});
flushSync();
assert.equal(document.querySelector('a[target="_blank"]').getAttribute('href'),'https://manage.auth0.com/dashboard/eu/hasbai/roles');
assert.equal(document.querySelector('.permission-editor form'),null);
assert.equal(document.querySelectorAll('.action-granted').length,1);
assert.ok(document.querySelectorAll('.scope-section').length>1);
flushSync(()=>document.querySelectorAll('.role-list button')[1].click());
assert.equal(document.querySelectorAll('.action-granted').length,0);
const search=document.querySelector('input[aria-label="搜索权限"]');
flushSync(()=>{search.value='没有的权限';search.dispatchEvent(new window.Event('input',{bubbles:true}));});
assert.ok(document.querySelector('.permission-editor').textContent.includes('无匹配权限'));
await unmount(app);
globalMessages.clear();

const profileSource=(await readFile(new URL('../../src/routes/profile/+page.svelte',import.meta.url),'utf8'))
  .replace("import { invalidate } from '$app/navigation';", "const invalidate=async()=>{};")
  .replace("import { isLoginRedirecting } from '$lib/auth-client';", "const isLoginRedirecting=()=>false;");
const ProfilePage=await loadComponent('src/routes/profile/+page.svelte',profileSource);
globalThis.fetch=async url=>Response.json(String(url)==='/auth/permissions'
  ? {permissions:[PERMISSION_CODES[0]],updatedAt:Date.now()}
  : {name:'测试人员',email:'test@18.cn',emailVerified:true,roles:[{name:'authenticated'},{name:'financing:admin'}],permissions:[]});
const profileApp=mount(ProfilePage,{target:document.body,props:{data:{email:'test@18.cn',account:{name:'测试人员',department:'资金管理部'}}}});
flushSync();
for(let i=0;i<10&&!document.querySelector('.permission-roles');i++){await new Promise(resolve=>setTimeout(resolve,0));flushSync();}
assert.deepEqual([...document.querySelectorAll('.permission-roles li')].map(node=>node.textContent.trim()),['基础用户','融资管理员']);
const refreshLinks=[...document.querySelectorAll('a')].filter(node=>node.textContent.trim()==='刷新权限');
assert.equal(refreshLinks.length,1);
assert.ok(refreshLinks[0].closest('.permission-footer'));
assert.equal(refreshLinks[0].getAttribute('href'),'/auth/login?returnTo=%2Fprofile');
assert.equal(document.querySelector('.profile-permissions .tr-panel-heading button'),null);
assert.equal(document.querySelector('.profile-permissions .tr-panel-heading a'),null);
assert.equal(document.querySelector('.profile-header form'),null);
assert.doesNotMatch(document.body.textContent,/刷新登录角色|刷新我的权限|授权缓存更新于|权限由 Auth0|仅支持 18.cn/);
await unmount(profileApp);
globalThis.fetch=async()=>Response.json({user:null,account:null});

const AccountHost=await loadComponent('tests/helpers/AccountHost.svelte',`<script>
import {setContext} from 'svelte';
import AuthMenu from '../../src/lib/AuthMenu.svelte';
let account=$state({name:'测试人员',department:'资金管理部'});
setContext('site-account',()=>account);
export function rename(){account={name:'新姓名',department:'资金管理部'}};
</script><AuthMenu />`);
const accountApp=mount(AccountHost,{target:document.body});flushSync();
assert.equal(document.querySelectorAll('a').length,1);
assert.equal(document.querySelector('a').getAttribute('href'),'/profile');
assert.match(document.querySelector('a').textContent,/测试人员\s*\/\s*资金管理部/);
assert.ok(document.querySelector('a svg'));
assert.equal(document.querySelector('[href="/management"]'),null);
flushSync(()=>accountApp.rename());assert.match(document.querySelector('a').textContent,/新姓名/);
await unmount(accountApp);

const Filter=await loadComponent('src/lib/financing/MultiSelectFilter.svelte');
const filterApp=mount(Filter,{target:document.body,props:{label:'负债品种',options:['固定收益凭证','公司债'],values:[],allLabel:'全部品种',optionLabels:{'固定收益凭证':'固收'}}});flushSync();
const details=document.querySelector('details');details.open=true;
flushSync(()=>document.querySelector('input[type="checkbox"]').click());
assert.match(document.querySelector('summary').textContent,/固收/);
window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));
assert.equal(details.open,false);
assert.equal(document.activeElement,document.querySelector('summary'));
details.open=true;
flushSync(()=>document.querySelector('.filter-popover button').click());
assert.match(document.querySelector('summary').textContent,/全部品种/);
assert.ok([...document.querySelectorAll('input')].every(input=>!input.checked));
await unmount(filterApp);await tick();await window.happyDOM.abort();
console.log('Management and account interaction checks passed');
