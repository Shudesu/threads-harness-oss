// Shared, content-free contract. Vendored into each tenant application at release time.
export const SCREENS = ['dashboard','chats','friends','posts','compose','schedule','insights','accounts','settings','integrations','broadcasts','scenarios','campaigns','tags','forms','media','rich_messages','rich_menus','staff','webinars','bookings','automation','personal_line','replies','quotes','growth','notifications','templates','reminders','scoring','affiliates','conversions','health','updates','users','pools','webhooks','events'] as const;
export type Screen = typeof SCREENS[number];
export const ACTIONS = ['navigate','chat_open','chat_search','chat_filter','chat_reply_focus','chat_send_click','attachment_open','account_switch','filter_change','preview_open','refresh_click','create_click','save_click','publish_click','schedule_click','cancel_click','analytics_stop','analytics_resume'] as const;
export type Action = typeof ACTIONS[number];
export const OPERATIONS = ['chat_send','chat_update','friend_update','post_create','post_update','post_publish','post_schedule','post_cancel','broadcast_create','broadcast_update','broadcast_send','scenario_create','scenario_update','campaign_create','campaign_update','account_connect','account_update','settings_save','tag_update','form_save','media_upload','rich_message_save','rich_menu_save','staff_update','booking_update','webinar_update','automation_update','post_reply','post_quote','growth_update','template_save','reminder_update','scoring_update','affiliate_update','conversion_update','pool_update','webhook_update','event_update','notification_update'] as const;
export type Operation = typeof OPERATIONS[number];
export type Event =
  | {kind:'screen';screen:Screen}
  | {kind:'action';screen:Screen;action:Action}
  | {kind:'operation';screen:Screen;operation:Operation;outcome:'accepted'|'rejected'|'server_error'|'network_error';status:number;duration:'under_1s'|'1_to_5s'|'over_5s'}
  | {kind:'engagement';screen:Screen;duration:'under_10s'|'10_to_60s'|'1_to_5m'|'over_5m'};
export type WireEvent=Event&{age_ms:number};
const isOneOf = (value:unknown, options:readonly string[]) => typeof value==='string' && options.includes(value);
export function validateEvent(value:unknown): value is WireEvent {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const e=value as Record<string,unknown>;
  if(typeof e.age_ms!=='number'||!Number.isInteger(e.age_ms)||e.age_ms<0||e.age_ms>60000)return false;
  if(!isOneOf(e.screen,SCREENS))return false;
  const fields = e.kind==='screen'?['kind','screen'] : e.kind==='action'?['kind','screen','action'] : e.kind==='operation'?['kind','screen','operation','outcome','status','duration'] : e.kind==='engagement'?['kind','screen','duration']:[];
  if(fields.length)fields.push('age_ms');
  if(!fields.length||Object.keys(e).length!==fields.length||Object.keys(e).some(k=>!fields.includes(k)))return false;
  if(e.kind==='screen')return true;
  if(e.kind==='action')return isOneOf(e.action,ACTIONS);
  if(e.kind==='engagement')return isOneOf(e.duration,['under_10s','10_to_60s','1_to_5m','over_5m']);
  if(!isOneOf(e.operation,OPERATIONS)||!isOneOf(e.duration,['under_1s','1_to_5s','over_5s'])||typeof e.status!=='number'||!Number.isInteger(e.status))return false;
  return e.outcome==='network_error'?e.status===0:
    e.outcome==='accepted'?e.status>=200&&e.status<300:
    e.outcome==='rejected'?e.status>=400&&e.status<500:
    e.outcome==='server_error'?e.status>=500&&e.status<=599:false;
}
export function screenForPath(path:string):Screen|null {
  const normalized=path.split(/[?#]/,1)[0].replace(/^\/console(?=\/|$)/,'').replace(/\/+$/,'')||'/';
  if(normalized==='/')return 'dashboard';
  const first=normalized.split('/')[1];
  return ({chats:'chats',friends:'friends',followers:'friends',posts:'posts',articles:'posts',compose:'compose',schedule:'schedule',insights:'insights',analytics:'insights',accounts:'accounts','line-accounts':'accounts','x-accounts':'accounts',settings:'settings',integrations:'integrations',broadcasts:'broadcasts',scenarios:'scenarios',campaigns:'campaigns','engagement-gates':'campaigns',tags:'tags',forms:'forms',images:'media',media:'media','rich-messages':'rich_messages','rich-menus':'rich_menus',staff:'staff',webinars:'webinars',bookings:'bookings',booking:'bookings',automations:'automation',personal:'personal_line',messages:'chats',replies:'replies',quotes:'quotes',growth:'growth','scheduled-posts':'schedule',campaign:'campaigns','comment-rules':'automation','auto-replies':'automation','friend-add-settings':'settings','form-submissions':'forms','inflow-links':'forms','affiliate-offers':'affiliates',affiliates:'affiliates',conversions:'conversions',duplicates:'friends',emergency:'health',health:'health',notifications:'notifications',templates:'templates',reminders:'reminders',scoring:'scoring',updates:'updates',news:'updates',users:'users',pools:'pools',webhooks:'webhooks',events:'events'} as Record<string,Screen>)[first]??null;
}
export function operationForPath(method:string,path:string):Operation|null {
  if(!['POST','PUT','PATCH','DELETE'].includes(method))return null;
  const p=path.split(/[?#]/,1)[0];
  if(p.startsWith('/api/product-analytics/'))return null;
  if(/^\/api\/chats\/[^/]+\/(send|messages)$/.test(p)&&method==='POST')return 'chat_send';
  if(/^\/api\/(chats|messages|dm)(\/|$)/.test(p))return /\/(send|reply)$/.test(p)?'chat_send':'chat_update';
  if(/^\/api\/(posts|media-posts|articles)(\/|$)/.test(p)){
    if(/\/(publish|publish-now)$/.test(p))return 'post_publish';
    if(/\/schedule$/.test(p))return 'post_schedule';
    if(/\/cancel$/.test(p)||method==='DELETE')return 'post_cancel';
    return /^\/api\/(posts|media-posts|articles)$/.test(p)&&method==='POST'?'post_create':'post_update';
  }
  if(/^\/api\/broadcasts(\/|$)/.test(p))return /\/(send|send-now)$/.test(p)?'broadcast_send':p==='/api/broadcasts'&&method==='POST'?'broadcast_create':'broadcast_update';
  if(/^\/api\/scenarios(\/|$)/.test(p))return p==='/api/scenarios'&&method==='POST'?'scenario_create':'scenario_update';
  if(/^\/api\/(campaigns|engagement-gates)(\/|$)/.test(p))return /^\/api\/(campaigns|engagement-gates)$/.test(p)&&method==='POST'?'campaign_create':'campaign_update';
  if(/^\/api\/(accounts|line-accounts|x-accounts|ig-accounts)(\/|$)/.test(p))return /\/(connect|check)$/.test(p)||/^\/api\/[^/]+$/.test(p)&&method==='POST'?'account_connect':'account_update';
  const first=p.split('/')[2];
  return ({friends:'friend_update',followers:'friend_update',settings:'settings_save',tags:'tag_update',forms:'form_save',images:'media_upload',media:'media_upload','rich-messages':'rich_message_save','rich-menus':'rich_menu_save',staff:'staff_update',booking:'booking_update',bookings:'booking_update',webinars:'webinar_update',automations:'automation_update','auto-replies':'automation_update','comment-rules':'automation_update',replies:'post_reply',quotes:'post_quote',growth:'growth_update',templates:'template_save',reminders:'reminder_update',scoring:'scoring_update',affiliates:'affiliate_update','affiliate-offers':'affiliate_update',conversions:'conversion_update',pools:'pool_update',webhooks:'webhook_update',events:'event_update',notifications:'notification_update'} as Record<string,Operation>)[first]??null;
}
