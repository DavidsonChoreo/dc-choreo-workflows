// The license check. Every hosted repository goes public, so it needs a
// license, and the passport's `license` field has to name the one in the file.
// Apache-2.0, MIT and BSD-3-Clause are allowed; anything else passes with a
// warning so Platform Engineering reviews it (pipeline.md, "License").

export const ALLOWED = ['Apache-2.0', 'MIT', 'BSD-3-Clause'];

// Order matters: the Affero and Lesser GPLs both contain the words of the GPL's title.
const SIGNATURES = [
  ['Apache-2.0', /Apache License,?\s+Version 2\.0/i],
  ['AGPL-3.0', /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/i],
  ['LGPL-3.0', /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i],
  ['GPL-3.0', /GNU GENERAL PUBLIC LICENSE\s+Version 3/i],
  ['MIT', /Permission is hereby granted, free of charge, to any person obtaining a copy/i],
  ['BSD-3-Clause', /Redistribution and use in source and binary forms[\s\S]*Neither the name of/i],
];

export function identifyLicense(text) {
  const found = SIGNATURES.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : null;
}

export function checkLicense({ licenseText, passportLicense }) {
  const problems = [];
  const warnings = [];

  if (licenseText === null) {
    problems.push('This repository has no LICENSE file. It goes public when the app is hosted, and code without a license is all rights reserved, which contradicts that. Add the license your passport names; the package writes Apache-2.0 by default.');
    return { ok: false, problems, warnings };
  }

  const found = identifyLicense(licenseText);
  if (found && found !== passportLicense) {
    problems.push(`The LICENSE file is ${found}, but the passport's \`license\` says ${passportLicense}. Make them match: change the file or the passport.`);
  } else if (!found && ALLOWED.includes(passportLicense)) {
    problems.push(`The LICENSE file doesn't read as ${passportLicense}, which the passport's \`license\` names. Replace it with the standard ${passportLicense} text.`);
  } else if (!ALLOWED.includes(passportLicense)) {
    warnings.push(`The license is ${found ?? passportLicense}, which isn't one of Choreo's default licenses (${ALLOWED.join(', ')}). Platform Engineering will review it before the app is published.`);
  }

  return { ok: problems.length === 0, problems, warnings };
}
