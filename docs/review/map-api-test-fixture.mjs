/** TEST ONLY. Synthetic principals/keys/records, in-memory Postgres, loopback server. No startup import. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createMapSessionVerifier } from '../../src/market-intel/map/auth.ts';
import { MapViewStore } from '../../src/market-intel/map/views.ts';
import { PostgresManualMapStore } from '../../src/market-intel/map/store/manualApproval.ts';
import { PostgresPrivateCatalogReader } from '../../src/market-intel/map/store/catalogReader.ts';
import { createMapPilotRouter } from '../../src/routes/market-intelligence/mapPilot.ts';

export async function createMapApiTestFixture() {
  const pg=new PGlite();let server;
  try{
    await pg.exec(await readFile(new URL('./map-store-schema.sql',import.meta.url),'utf8'));
    const issuer='https://synthetic.supabase.co/auth/v1', expiry=Date.now()/1000+3600;
    const principals=Object.fromEntries(['admin','memberA','memberB','unapproved'].map(name=>[name,{issuer,subject:'synthetic-'+name,expiresAt:expiry}]));
    await pg.query(`INSERT INTO mi_map_private.access_admin_grants VALUES ($1,$2,$3,true,to_timestamp($4),'synthetic fixture only')`,
      [randomUUID(),issuer,principals.admin.subject,expiry]);
    const database=role=>({query:(text,values=[])=>pg.transaction(async tx=>{
      await tx.exec(`SET LOCAL ROLE ${role}`);return tx.query(text,values);
    }),transaction:work=>pg.transaction(async tx=>{await tx.exec(`SET LOCAL ROLE ${role}`);return work(tx);})});
    const store=new PostgresManualMapStore(database('mi_map_access_writer'));
    const authority=new PostgresManualMapStore(database('mi_map_reader'));
    const catalog=new PostgresPrivateCatalogReader(database('mi_map_reader'));
    for(const name of ['memberA','memberB']){
      const result=await store.change(principals.admin,{issuer,subject:principals[name].subject,action:'approve',expectedRevision:0,
        requestId:randomUUID(),reason:'synthetic map member fixture',expiresAt:expiry-100});
      if(!result.ok)throw Error('FIXTURE_APPROVAL_FAILED');
    }
    await pg.query('INSERT INTO mi_map_private.source_products VALUES ($1,$2,$3)',
      ['synthetic-product','Synthetic provider','https://example.invalid/source']);
    const hash='a'.repeat(64);
    for(const [layerId,geo]of [['us-state-acs-population','US-STATE-04'],['us-state-acs-population','US-STATE-48'],
      ['us-state-acs-household-income','US-STATE-04']]){
      const key=layerId+'-'+geo;
      await pg.query(`INSERT INTO mi_map_private.rights_controls
        (clearance_id,product_id,source_revision_id,boundary_hash,state,allow_ui,valid_until,evidence_ref,notices)
        VALUES ($1,'synthetic-product',$1,$2,'cleared',true,to_timestamp($3),'private fixture evidence',$4)`,
        [key,hash,expiry,JSON.stringify(['Synthetic provider attribution'])]);
      await pg.query(`INSERT INTO mi_map_private.catalog_releases
        (release_id,layer_id,geography_id,product_id,source_revision_id,boundary_version,boundary_hash,crosswalk_ref,
          clearance_id,qualified,observation_count,source_hash,parser_version,definition_version,retrieved_at,as_of)
        VALUES ($1,$2,$3,'synthetic-product',$1,'cb-2024-500k',$4,'explicit synthetic state crosswalk',$1,true,1,$4,
          'synthetic-parser-1','synthetic-definition-1',clock_timestamp(),clock_timestamp())`,[key,layerId,geo,hash]);
      await pg.query('INSERT INTO mi_map_private.observations VALUES ($1,0,$2)',[key,JSON.stringify({
        observationId:'synthetic-observation',metricId:layerId,periodStart:'2020-01-01',periodEnd:'2024-12-31',
        periodLabel:'2020–2024 five-year estimate',unit:layerId.includes('income')?'USD':'persons',currency:layerId.includes('income')?'USD':null,
        priceBasis:layerId.includes('income')?'2024 inflation-adjusted dollars':null,universe:'synthetic universe',
        sourceGeographyId:geo==='US-STATE-04'?'0400000US04':'0400000US48',sourceGeographyVintage:'2024',
        dimensions:{statistic:'total'},value:0,status:'available',rawValueMarker:null,marginOfError:null,rawMoeMarker:'*****',
        qualityFlags:['synthetic'],privateActor:'must not escape'})]);
      await pg.query(`INSERT INTO mi_map_private.publication_heads VALUES ($1,$2,$3,'published',1)`,[layerId,geo,key]);
    }
    const {publicKey,privateKey}=await generateKeyPair('ES256'),jwk=await exportJWK(publicKey);
    const tokens={};
    for(const[name,p]of Object.entries(principals))tokens[name]=await new SignJWT({role:'authenticated',is_anonymous:false})
      .setIssuer(issuer).setAudience('authenticated').setSubject(p.subject).setExpirationTime(expiry)
      .setProtectedHeader({alg:'ES256',kid:'synthetic'}).sign(privateKey);
    const deps={enabled:()=>true,adminEnabled:()=>true,adminOrigin:'https://not-configured.invalid',authority,catalog,
      administrator:store,views:new MapViewStore(),verifier:createMapSessionVerifier({issuer,audience:'authenticated'},
      {keyResolver:createLocalJWKSet({keys:[{...jwk,alg:'ES256',kid:'synthetic'}]})})};
    const app=express();app.use('/v1',createMapPilotRouter(deps));
    app.use('/ui',express.static(fileURLToPath(new URL('../../ui/',import.meta.url))));
    // Browser tests alone use this synthetic loopback proxy; actual router still verifies every request.
    app.use('/browser-test/v1',(req,res,next)=>{req.headers.authorization='Bearer '+tokens.admin;next();},createMapPilotRouter(deps));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}`;deps.adminOrigin=url;
    const request=async(path,name='memberA',options={})=>{
      const headers={...(name?{Authorization:'Bearer '+tokens[name]}:{}),...options.headers};
      if(options.body&&typeof options.body!=='string'){headers['Content-Type']='application/json';options={...options,body:JSON.stringify(options.body)};}
      const r=await fetch(url+path,{...options,headers});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};
    };
    return {pg,deps,url,principals,store,catalog,request,async close(){
      await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await pg.close();}};
  }catch(error){if(server)await new Promise(resolve=>server.close(resolve));await pg.close();throw error;}
}
