import { expect, it, vi } from 'vitest';
import { validDraftContent, validMediaUrl } from '../shared/media.mjs';
import { ThreadsApi } from '../src/threads';
it.each(['http://cdn.example.com/x','https://127.0.0.1/x','https://2130706433/x','https://[::1]/x','https://localhost/x','https://a.local/x','https://u:secret@cdn.example.com/x','https://cdn.example.com/x#token','data:image/png;base64,abc'])('rejects non-public/unsafe media URL %s', url => expect(validMediaUrl(url)).toBe(false));
it('allows captions to be empty only with valid media, bounds emoji and number of items',()=>{
 const m={type:'IMAGE',url:'https://cdn.example.com/a.png'};
 expect(validDraftContent('',[m])).toBe(true); expect(validDraftContent('',[])).toBe(false);
 expect(validDraftContent('😀'.repeat(125),[m])).toBe(true); expect(validDraftContent('😀'.repeat(126),[m])).toBe(false);
 expect(validDraftContent('',Array(20).fill(m))).toBe(true); expect(validDraftContent('',Array(21).fill(m))).toBe(false);
});
it('uses official media parameters and publishes only the parent container',async()=>{
 const fetcher=vi.fn(async()=>Response.json({id:'12345'})); const api=new ThreadsApi('secret',fetcher);
 await api.create('99','caption','88',{type:'IMAGE',url:'https://cdn.example.com/a.png'});
 await api.createMediaChild('99',{type:'VIDEO',url:'https://cdn.example.com/a.mp4'});
 await api.createCarousel('99','album',['1','2'],'88'); await api.publish('99','12345');
 const bodies=fetcher.mock.calls.map((c:any)=>Object.fromEntries(c[1].body));
 expect(bodies[0]).toEqual({media_type:'IMAGE',text:'caption',reply_to_id:'88',image_url:'https://cdn.example.com/a.png'});
 expect(bodies[1]).toEqual({media_type:'VIDEO',is_carousel_item:'true',video_url:'https://cdn.example.com/a.mp4'});
 expect(bodies[2]).toEqual({media_type:'CAROUSEL',text:'album',children:'1,2',reply_to_id:'88'});
 expect(bodies[3]).toEqual({creation_id:'12345'});
 expect(fetcher.mock.calls.every((c:any)=>String(c[0]).startsWith('https://graph.threads.net/v1.0/'))).toBe(true);
});
