#!/usr/local/bin/node
'use strict';

/*
* @module ffprobe
* @author plundell <qmusicplayer@protonmail.com>
* @license Apache-2.0
* @description Wrapper for ffprobe to get information about local and remote resources
* @depends libbetter
* @exports function   Exporter function that should be called once with dependencies to yield:
* @return function    Function that returns information about a file or stream
*
*/
module.exports = function exportFFprobe(scope,settings){
    
    const BetterLog=scope.BetterLog
    const cX=scope.BetterUtil.cX
    const ffprobePromise=scope.BetterUtil.cpX.execFileInPromise.ffprobe
    const ffprobeSync=scope.BetterUtil.cpX.execFileSync.ffprobe

    const log=new BetterLog('FFprobe');


	/*
	* So we don't need to run ffprobe back-to-back we cache the results for 10 minutes (arbitrary number, just
	* so we don't build up a huge memory footprint when we run for days, or have an interval that runs too often)
	*/
	var ffprobe_cache={};
	setInterval(function clearFFprobeCache(){
		log.trace("Clearing cache...");
		ffprobe_cache={};
	},60000)

	function getArgs(path){
		return [
			'-v','error'
			,'-select_streams','a:0'
			,'-show_streams'
			,'-show_format'
			,'-of','json'
			,path
		];
	}

	


	function ffprobe_fail(path,obj){
		//If any stderr exists, print that
		log.warn(obj);
		let extra=obj.stderr ? cX.limitString('STDERR:\n'+obj.stderr,500) : undefined;
		ffprobe_cache[path]=log.makeError(obj.error,extra).somewhere(path); //will include path and 'ffprobe'
		throw ffprobe_cache[path];
	}

	function ffprobe_success(path,obj){
		var info=cX.tryJsonParse(obj.stdout);
		if(!info)
			throw log.makeError(`ffprobe returned unexpected value for path '${path}':`,obj);
		else if(!Array.isArray(info.streams) || !info.streams.length || !info.format)
			throw log.makeError(`ffprobe didn't return all requested data for '${path}':`,info);
		
		try{
			//grab the info we need using some fancy destructuring assignment
			var {streams:[s],format:f}=info
			s=cX.keysToLower(s);
			f=cX.keysToLower(f);
			var t=f.tags ? cX.keysToLower(f.tags): {};

			//This doesn't mean we support the file, just that ffprobe found the file and ran...
			ffprobe_cache[path]={
				codec:cX.toLower(s.codec_name,null)
				,format:cX.toLower(f.format_name,null).split(',')[0] //eg. format 'hls' has format_name='hls,applehttp'
				,size:parseInt(f.size)||null
				,bit_rate:parseInt(f.bit_rate)||null
				,sample_rate:parseInt(s.sample_rate)||null
				,bit_depth:parseInt(s.bits_per_raw_sample)||null
				,channels:parseInt(s.channels)||null
				,duration:parseInt(s.duration)||null
				,title:t.title||t.name||null
				,album:t.album||null
				,artist:t.artist || t.albumartist || t.album_artist || t.composer||null
				,year:(new Date(t.year || t.date)).getFullYear() || null
				,genre:t.genre || null
			};

			return ffprobe_cache[path];

		}catch(err){
			throw log.makeError('Failed while extracting info from ffprobe result.',info,err);
		}
	}



	/*
	* Get information about a local or remote resource using ffprobe
	*
	* @param string path      A path to the local filesystem, remote filesystem or a url
	* @opt number timeout     Default 100 ms. How long before the returned promise rejects
	*
	* @return Promise(object,err)
	* @exported
	*/
	function ffprobe(path,timeout){
		//If we don't have the info cached, fetch and process it...
		if(!ffprobe_cache.hasOwnProperty(path)){
			ffprobe_cache[path]=ffprobePromise(getArgs(path), {timeout:timeout, encoding:'utf8'})
				.then(
					obj=>ffprobe_success(path,obj)
					,obj=>ffprobe_fail(path,obj)
				)
		}else if(ffprobe_cache[path] instanceof Error){
			//If the promise has already been resolved to a an error, return it as a rejected err
			return Promise.reject(ffprobe_cache[path])
		}

		//Now return what may be ready data, or a pending promise...
		return ffprobe_cache[path];
		
	}

	ffprobe.sync=function ffprobe_sync(path,timeout){
		var x=ffprobe_cache[path];
		if(!x || cX.varType(x)=='promise'){
			//Both if none exists or if only a promise exists we'll have to run ffprobe to keep it sync
			try{
				x=ffprobeSync(getArgs(path), {timeout:timeout, encoding:'utf8'})
			}catch(err){
				x=err;
			}
			ffprobe_cache[path]=x
		} 
		if(x instanceof Error){
			throw x;
		}else{
			return x;
		}
	}



	return {ffprobe};

};

