import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDom, loadComponent } from './svelte-dom.mjs';
const window = installDom();
const { mount, unmount, flushSync, tick } = await import('svelte');
const { globalMessages } = await import('../../src/lib/global-messages.ts');
const { PERMISSION_CODES } = await import('../../src/lib/permissions.ts');
const {createClientSession}=await import('../../src/lib/client-session.ts');
const session=createClientSession({user:{id:'auth0|test',email:'test@18.cn'},account:{name:'测试人员',department:'资金管理部'},roles:[{id:'rol_TestAdmin',name:'admin'}],permissions:[...PERMISSION_CODES],expiresAt:Date.now()/1000+3600});
const context=new Map([['site-session',session]]);
globalThis.fetch = async () => Response.json({user:null,account:null});
const Page = await loadComponent('src/routes/management/people/+page.svelte', (await readFile(new URL('../../src/routes/management/people/+page.svelte',import.meta.url),'utf8')).replace("import { invalidate } from '$app/navigation';", "const invalidate=async()=>{};"));
const app = mount(Page,{context,target:document.body,props:{data:{roles:[{id:'rol_A',name:'测试管理员',description:''},{id:'rol_B',name:'测试成员',description:''}],configurations:{rol_A:{permissions:[PERMISSION_CODES[0]]},rol_B:{permissions:[]}},permissions:['auth.permission:update'],updatedAt:Date.now(),mode:'enforce'}}});
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

const profileSource=(await readFile(new URL('../../src/routes/management/me/+page.svelte',import.meta.url),'utf8'))
  .replace("import { invalidate } from '$app/navigation';", "const invalidate=async()=>{};")
  .replace("import { isLoginRedirecting } from '$lib/auth-client';", "const isLoginRedirecting=()=>false;");
const ProfilePage=await loadComponent('src/routes/management/me/+page.svelte',profileSource);
globalThis.fetch=async()=>Response.json({name:'测试人员',email:'test@18.cn',emailVerified:true,roles:[],permissions:[]});
const profileApp=mount(ProfilePage,{context,target:document.body,props:{data:{email:'test@18.cn',account:{name:'测试人员',department:'资金管理部'}}}});
for(let i=0;i<10;i++){await new Promise(resolve=>setTimeout(resolve,0));flushSync();}
assert.equal(document.querySelector('input[name="name"]').value,'测试人员');
assert.equal(document.querySelector('.profile-permissions'),null,'permissions moved to their own page');
await unmount(profileApp);
const PermissionPage=await loadComponent('src/routes/management/permissions/+page.svelte');
session.seed({...session.current(),roles:[{id:'rol_A',name:'authenticated'},{id:'rol_B',name:'financing:admin'}],permissions:[PERMISSION_CODES[0]]});
const permissionsApp=mount(PermissionPage,{context,target:document.body});flushSync();
assert.deepEqual([...document.querySelectorAll('.permission-roles li')].map(node=>node.textContent.trim()),['基础用户','融资管理员']);
assert.equal([...document.querySelectorAll('a')].find(node=>node.textContent.trim()==='刷新权限').getAttribute('href'),'/auth/login?returnTo=%2Fmanagement%2Fpermissions');
assert.equal(document.querySelectorAll('.action-granted').length,1);
await unmount(permissionsApp);

const AccountHost=await loadComponent('tests/helpers/AccountHost.svelte',`<script>
import {setContext} from 'svelte';
import AuthMenu from '../../src/lib/AuthMenu.svelte';
let account=$state({name:'测试人员',department:'资金管理部'});
setContext('site-account',()=>account);
export function rename(){account={name:'新姓名',department:'资金管理部'}};
</script><AuthMenu />`);
const accountApp=mount(AccountHost,{context,target:document.body});flushSync();
assert.equal(document.querySelectorAll('a').length,1);
assert.equal(document.querySelector('a').getAttribute('href'),'/management/me');
assert.match(document.querySelector('a').textContent,/测试人员\s*\/\s*资金管理部/);
assert.ok(document.querySelector('a svg'));
assert.equal(document.querySelector('[href="/management"]'),null);
flushSync(()=>accountApp.rename());assert.match(document.querySelector('a').textContent,/新姓名/);
await unmount(accountApp);

// Popover interaction and focus are covered in tests/visual/ui-contracts.spec.mjs.
await tick();await window.happyDOM.abort();
console.log('Management and account interaction checks passed');
