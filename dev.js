const browserify = require('browserify');
const fse        = require('fs-extra');
const path       = require('path');
const watchify   = require('watchify');
const sourceMaps = require('source-map-support');
const livereload = require('livereload');

const utils          = require('./lib/utils.js');
const transform      = require('./lib/transforms');
const codeTransform  = require('./lib/transforms/code.js');
const renderer       = require('./lib/renderer.js');
const getOpts        = require('./lib/getopts.js');
const log            = require('./lib/utils/log.js');
const Less           = require('./lib/utils/less.js');


const startApp = async (opts)=>{
	if(!opts.app){
		console.log(`A server app was not specified, dev server will not run. Set 'main' in your package.json to enable this.`);
		return;
	}
	const nodemon    = require('nodemon');
	return new Promise((resolve, reject)=>{
		let deps = [];
		browserify({ require : opts.app, bundleExternal : false,
			postFilter : (id, filepath, pkg)=>{
				if(id.indexOf(opts.paths.build) !== -1) return false;
				deps.push(filepath);
				return true;
			}
		})
		.transform((file)=>transform(file, opts, [codeTransform]), {global : true})
		.bundle((err)=>err?reject(err):resolve(deps));
	})
	.then((appDeps)=>{
		return nodemon({ script:opts.app, watch:appDeps, delay:2 })
			.on('restart', (files)=>log.restartServer(opts.app, files));
	})
};

const devEntryPoint = async (entryPoint, Opts)=>{
	let opts = Object.assign({
		entry : {
			name : path.basename(entryPoint).split('.')[0],
			dir  : path.dirname(entryPoint)
		}
	}, Opts);

	if(!fse.pathExistsSync(path.resolve(process.cwd(), opts.paths.build, opts.entry.name))){
		throw log.notBuilt(opts.entry);
	}

	const bundler = browserify({
			cache         : {},
			packageCache  : {},
			debug         : true,
			standalone    : opts.entry.name,
			paths         : opts.shared,
			plugin        : [watchify],
			ignoreMissing : true,
			postFilter    : (id, filepath, pkg)=>{
				return utils.shouldBundle(filepath, id, opts);
			},
		})
		.require(entryPoint)
		.transform((file)=>transform(file, opts), {global : true})
		.on('update', (files)=>{
			log.rebundle(opts.entry, files);
			bundle();
		});

	let lastBundle;
	const bundle = async ()=>{
		const logEnd = log.buildEntryPoint(opts.entry);
		await utils.bundle(bundler).then((code)=>{
			if(lastBundle != code) fse.writeFileSync(paths.code, code);
			lastBundle = code;
		});
		await Less.compile(opts).then((css)=>fse.writeFile(paths.style, css));
		logEnd();
	};

	const paths = utils.paths(opts.paths, opts.entry.name);
	await renderer(Object.assign(opts, {dev : true}));
	await bundle();
};

const setupLiveReload = (opts)=>{
	const lr = livereload.createServer();
	lr.server.on('error', (err)=>{
		if(err.code == 'EADDRINUSE'){
			console.log('ERR: Could not setup LiveReload conection. This is because another instance of Vitreum Dev is running.');
		}else{
			throw err;
		}
	})
	lr.watch(opts.paths.build);
};

module.exports = async (entryPoints, opts)=>{
	opts = getOpts(opts, entryPoints);
	log.beginDev(opts);
	sourceMaps.install();
	await opts.targets.reduce((flow, ep)=>flow.then(()=>devEntryPoint(ep, opts)), Promise.resolve());
	setupLiveReload(opts);
	return await startApp(opts);
};
