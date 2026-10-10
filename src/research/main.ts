import {pathToFileURL} from 'node:url';
import {createResearchHost,createResearchResources} from './runtime.ts';
import {PostgresResearchAuthority} from './authority.ts';

/** Dedicated start command only. Never imported by the existing API startup. */
export async function runResearchHost(env:NodeJS.ProcessEnv=process.env) {
  const raw=env.PORT??'3000';if(!/^[1-9][0-9]{0,4}$/.test(raw)||Number(raw)>65535)throw Error('RESEARCH_PORT_INVALID');
  const host=await createResearchHost(env,{createResources:config=>createResearchResources(env,config,
    (pool,issuer)=>new PostgresResearchAuthority(pool,issuer))});
  const server=host.app.listen(Number(raw),'0.0.0.0');
  try{await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',()=>reject(Error('RESEARCH_LISTEN_FAILED')));});}
  catch{try{await host.shutdown();}catch{}throw Error('RESEARCH_START_FAILED');}
  process.stdout.write('RESEARCH_HOST_STARTED\n');let closing:Promise<void>|undefined;
  const close=()=>closing??=(async()=>{
    let failed=false;
    const timer=setTimeout(()=>{server.closeAllConnections();},5000);timer.unref();
    try{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(Error('RESEARCH_CLOSE_FAILED')):resolve()));}
    catch{failed=true;}finally{clearTimeout(timer);}
    try{await host.shutdown();}catch{failed=true;}
    if(failed){process.stderr.write('RESEARCH_SHUTDOWN_FAILED\n');process.exitCode=1;}
    process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);
  })();
  const signal=()=>{void close();};process.once('SIGTERM',signal);process.once('SIGINT',signal);
  return {server,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await runResearchHost();}catch{process.stderr.write('RESEARCH_START_FAILED\n');process.exitCode=1;}
}
