const axios = require('axios');
const cheerio = require('cheerio');
const core = require('@actions/core');

const version = process.argv[2]; // Получение версии OpenWRT из аргумента командной строки

const SNAPSHOT_TARGETS_TO_BUILD = ['mediatek', 'ramips', 'x86', 'armsr', 'rockchip'];
const SNAPSHOT_SUBTARGETS_TO_BUILD = ['filogic', 'mt7622', 'mt7623', 'mt7629', 'mt7620', 'mt7621', 'mt76x8', '64', 'generic', 'armv8'];

if (!version || version !== 'SNAPSHOT') {
  core.setFailed('Only "SNAPSHOT" version is supported');
  process.exit(1);
}

const url = 'https://downloads.openwrt.org/snapshots/targets/';

async function fetchHTML(url) {
  try {
    const { data } = await axios.get(url);
    return cheerio.load(data);
  } catch (error) {
    console.error(`Error fetching HTML for ${url}: ${error}`);
    throw error;
  }
}

async function getTargets() {
  const $ = await fetchHTML(url);
  const targets = [];
  $('table tr td.n a').each((index, element) => {
    const name = $(element).attr('href');
    if (name && name.endsWith('/')) {
      targets.push(name.slice(0, -1));
    }
  });
  return targets;
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${url}${target}/`);
  const subtargets = [];
  $('table tr td.n a').each((index, element) => {
    const name = $(element).attr('href');
    if (name && name.endsWith('/')) {
      subtargets.push(name.slice(0, -1));
    }
  });
  return subtargets;
}

async function getDetails(target, subtarget) {
  const kmodsUrl = `${url}${target}/${subtarget}/kmods/`;
  let vermagic = '';
  let pkgarch = '';

  try {
    // Получаем список файлов kmods
    const $ = await fetchHTML(kmodsUrl);
    const kmodsLinks = [];
    $('a').each((index, element) => {
      const name = $(element).attr('href');
      if (name && name.match(/^\d+\.\d+\.\d+-\d+-[a-f0-9]{10,}\.tar\.xz$/)) {
        kmodsLinks.push(name);
      }
    });

    if (kmodsLinks.length > 0) {
      // Берем первую ссылку, которая соответствует шаблону
      const firstKmodLink = kmodsLinks[0];
      const firstKmodUrl = `${kmodsUrl}${firstKmodLink}/index.json`;

      // Загружаем index.json для получения pkgarch
      const response = await axios.get(firstKmodUrl);
      const data = response.data;
      if (data && data.architecture) {
        pkgarch = data.architecture;
        console.log(`Found pkgarch: ${pkgarch} for ${target}/${subtarget}`);
      }
    }

    // Получаем информацию о vermagic из пакетов ядра на странице packages/
    const packagesUrl = `${url}${target}/${subtarget}/packages/`;
    const $packages = await fetchHTML(packagesUrl);
    $('a').each((index, element) => {
      const name = $(element).attr('href');
      if (name && name.startsWith('kernel-')) {
        const vermagicMatch = name.match(/kernel-\d+\.\d+\.\d+~([a-f0-9]{10,})(?:-r\d+)?\.apk$/);
        if (vermagicMatch) {
          vermagic = vermagicMatch[1];  // Сохраняем значение vermagic
          console.log(`Found vermagic: ${vermagic} for ${target}/${subtarget}`);
        }
      }
    });

  } catch (error) {
    console.error(`Error fetching data for ${target}/${subtarget}: ${error.message}`);
  }

  return { vermagic, pkgarch };
}

async function main() {
  try {
    const targets = await getTargets();
    const jobConfig = [];

    for (const target of targets) {
      const subtargets = await getSubtargets(target);
      for (const subtarget of subtargets) {
        const { vermagic, pkgarch } = await getDetails(target, subtarget);

        if (SNAPSHOT_SUBTARGETS_TO_BUILD.includes(subtarget) && SNAPSHOT_TARGETS_TO_BUILD.includes(target)) {
          jobConfig.push({
            tag: version,
            target,
            subtarget,
            vermagic,   // Добавляем vermagic в конфигурацию
            pkgarch,    // Добавляем pkgarch в конфигурацию
          });
        }
      }
    }

    // Логируем конфигурацию перед передачей
    console.log('Job config:', jobConfig);

    // Передаем job-config в следующий шаг
    core.setOutput('job-config', JSON.stringify(jobConfig));

  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
