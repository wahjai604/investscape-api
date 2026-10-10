import { createRemoteJWKSet,errors,jwtVerify,type JWTVerifyGetKey } from 'jose';
export interface ResearchSession {issuer:string;subject:string;sessionId:string;expiresAt:number;}
export interface ResearchVerifier {verify(header:string|undefined):Promise<ResearchSession|null>;}
export interface ResearchAuthConfig {issuer:string;audience:'authenticated';}
/** Independent Research authentication. No map approvals, user_metadata roles or shared-secret fallback. */
export function createResearchVerifier(config:ResearchAuthConfig,keyResolver?:JWTVerifyGetKey):ResearchVerifier {
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1$/.test(config.issuer)||config.audience!=='authenticated')
    throw Error('RESEARCH_UNAVAILABLE');
  const key=keyResolver??createRemoteJWKSet(new URL(config.issuer+'/.well-known/jwks.json'));
  return {async verify(header){
    if(!header||header.length>16384||!/^Bearer +[^\s]+$/i.test(header))return null;
    try{const {payload}=await jwtVerify(header.replace(/^Bearer +/i,''),key,{issuer:config.issuer,
      audience:config.audience,algorithms:['ES256','RS256'],requiredClaims:['iss','aud','sub','exp','session_id'],clockTolerance:0});
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if(typeof payload.sub!=='string'||!uuid.test(payload.sub)||typeof payload.session_id!=='string'||!uuid.test(payload.session_id)||payload.role!=='authenticated'||
        payload.is_anonymous!==false||!Number.isFinite(payload.exp)||payload.exp!<=Date.now()/1000)return null;
      return {issuer:config.issuer,subject:payload.sub,sessionId:payload.session_id,expiresAt:payload.exp!};
    }catch(error){if(error instanceof errors.JOSEError&&error.code!=='ERR_JWKS_TIMEOUT')return null;
      throw Error('RESEARCH_UNAVAILABLE');}
  }};
}
