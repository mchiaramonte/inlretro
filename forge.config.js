module.exports = {
  packagerConfig: {
    icon: 'assets/icon/icon',
    asar: true,
    name: 'INL Retro Programmer Dumper',
    executableName: 'inlretro',
    ignore: [
      /^\/node_modules/,
      /^\/out\//,
      /^\/\.git/,
      /^\/\.gitignore$/,
      /^\/forge\.config\.js$/,
      /^\/package-lock\.json$/,
      /^\/README\.md$/,
      /^\/BUG_REPORT\.md$/,
      /^\/DUMP_FLOW_REFERENCE\.md$/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'INLRetro',
        authors: 'clearvus / InfiniteNesLives',
        description: 'UI for INL Retro Dumper / Programmer',
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {},
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['linux'],
    },
  ],
};
