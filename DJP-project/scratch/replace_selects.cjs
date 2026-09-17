const fs = require('fs');

const file = './frontend/src/views/MasterDataRepositoryView.jsx';
let content = fs.readFileSync(file, 'utf8');

const replacements = [
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '120px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{pjpFilters\.zone\}\s+onChange=\{\(e\) => \{ setPjpFilters\(prev => \(\{ \.\.\.prev, zone: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Zones<\/option>\s+\{filterOptions\.pjpZones\.map\(z => \(\s+<option key=\{z\} value=\{z\}>\{z\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.pjpZones} value={pjpFilters.zone} onChange={v => { setPjpFilters(prev => ({ ...prev, zone: v })); setPage(1); }} placeholder="Zones" width="120px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '140px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{pjpFilters\.area\}\s+onChange=\{\(e\) => \{ setPjpFilters\(prev => \(\{ \.\.\.prev, area: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Areas<\/option>\s+\{filterOptions\.pjpAreas\.map\(a => \(\s+<option key=\{a\} value=\{a\}>\{a\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.pjpAreas} value={pjpFilters.area} onChange={v => { setPjpFilters(prev => ({ ...prev, area: v })); setPage(1); }} placeholder="Areas" width="140px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '150px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{pjpFilters\.soName\}\s+onChange=\{\(e\) => \{ setPjpFilters\(prev => \(\{ \.\.\.prev, soName: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Sales Officers<\/option>\s+\{filterOptions\.pjpSos\.map\(s => \(\s+<option key=\{s\} value=\{s\}>\{s\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.pjpSos} value={pjpFilters.soName} onChange={v => { setPjpFilters(prev => ({ ...prev, soName: v })); setPage(1); }} placeholder="Sales Officers" width="150px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '130px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{pjpFilters\.category\}\s+onChange=\{\(e\) => \{ setPjpFilters\(prev => \(\{ \.\.\.prev, category: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Categories<\/option>\s+\{filterOptions\.pjpCategories\.length > 0 \? \(\s+filterOptions\.pjpCategories\.map\(c => \(\s+<option key=\{c\} value=\{c\}>Category \{c\}<\/option>\s+\)\)\s+\) : \(\s+<>\s+<option value="A">Category A<\/option>\s+<option value="B">Category B<\/option>\s+<option value="C">Category C<\/option>\s+<option value="D">Category D<\/option>\s+<\/>\s+\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.pjpCategories.length > 0 ? filterOptions.pjpCategories : ['A', 'B', 'C', 'D']} value={pjpFilters.category} onChange={v => { setPjpFilters(prev => ({ ...prev, category: v })); setPage(1); }} placeholder="Categories" width="130px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '140px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{pjpFilters\.status\}\s+onChange=\{\(e\) => \{ setPjpFilters\(prev => \(\{ \.\.\.prev, status: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Status<\/option>\s+\{filterOptions\.pjpStatuses\.length > 0 \? \(\s+filterOptions\.pjpStatuses\.map\(s => \(\s+<option key=\{s\} value=\{s\}>\{s\}<\/option>\s+\)\)\s+\) : \(\s+<>\s+<option value="Growing">Growing<\/option>\s+<option value="De-growing">De-growing<\/option>\s+<option value="Zero lifter">Zero lifter<\/option>\s+<option value="Need to Grow">Need to Grow<\/option>\s+<option value="Prospective">Prospective<\/option>\s+<\/>\s+\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.pjpStatuses.length > 0 ? filterOptions.pjpStatuses : ['Growing', 'De-growing', 'Zero lifter', 'Need to Grow', 'Prospective']} value={pjpFilters.status} onChange={v => { setPjpFilters(prev => ({ ...prev, status: v })); setPage(1); }} placeholder="Status" width="140px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '130px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{mapFilters\.region\}\s+onChange=\{\(e\) => \{ setMapFilters\(prev => \(\{ \.\.\.prev, region: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Regions<\/option>\s+\{filterOptions\.mappingRegions\.map\(r => \(\s+<option key=\{r\} value=\{r\}>\{r\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.mappingRegions} value={mapFilters.region} onChange={v => { setMapFilters(prev => ({ ...prev, region: v })); setPage(1); }} placeholder="Regions" width="130px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '150px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{mapFilters\.area\}\s+onChange=\{\(e\) => \{ setMapFilters\(prev => \(\{ \.\.\.prev, area: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Areas<\/option>\s+\{filterOptions\.mappingAreas\.map\(a => \(\s+<option key=\{a\} value=\{a\}>\{a\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.mappingAreas} value={mapFilters.area} onChange={v => { setMapFilters(prev => ({ ...prev, area: v })); setPage(1); }} placeholder="Areas" width="150px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '160px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{mapFilters\.soName\}\s+onChange=\{\(e\) => \{ setMapFilters\(prev => \(\{ \.\.\.prev, soName: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Sales Officers<\/option>\s+\{filterOptions\.mappingSos\.map\(s => \(\s+<option key=\{s\} value=\{s\}>\{s\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.mappingSos} value={mapFilters.soName} onChange={v => { setMapFilters(prev => ({ ...prev, soName: v })); setPage(1); }} placeholder="Sales Officers" width="160px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '120px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{dealerFilters\.zone\}\s+onChange=\{\(e\) => \{ setDealerFilters\(prev => \(\{ \.\.\.prev, zone: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Zones<\/option>\s+\{filterOptions\.dealerZones\.map\(z => \(\s+<option key=\{z\} value=\{z\}>\{z\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.dealerZones} value={dealerFilters.zone} onChange={v => { setDealerFilters(prev => ({ ...prev, zone: v })); setPage(1); }} placeholder="Zones" width="120px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '130px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{dealerFilters\.region\}\s+onChange=\{\(e\) => \{ setDealerFilters\(prev => \(\{ \.\.\.prev, region: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Regions<\/option>\s+\{filterOptions\.dealerRegions\.map\(r => \(\s+<option key=\{r\} value=\{r\}>\{r\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.dealerRegions} value={dealerFilters.region} onChange={v => { setDealerFilters(prev => ({ ...prev, region: v })); setPage(1); }} placeholder="Regions" width="130px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '140px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{dealerFilters\.area\}\s+onChange=\{\(e\) => \{ setDealerFilters\(prev => \(\{ \.\.\.prev, area: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Areas<\/option>\s+\{filterOptions\.dealerAreas\.map\(a => \(\s+<option key=\{a\} value=\{a\}>\{a\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.dealerAreas} value={dealerFilters.area} onChange={v => { setDealerFilters(prev => ({ ...prev, area: v })); setPage(1); }} placeholder="Areas" width="140px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '120px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{dealerFilters\.dealerType\}\s+onChange=\{\(e\) => \{ setDealerFilters\(prev => \(\{ \.\.\.prev, dealerType: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Types<\/option>\s+\{filterOptions\.dealerTypes\.map\(t => \(\s+<option key=\{t\} value=\{t\}>\{t\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.dealerTypes} value={dealerFilters.dealerType} onChange={v => { setDealerFilters(prev => ({ ...prev, dealerType: v })); setPage(1); }} placeholder="Types" width="120px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '110px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{dealerFilters\.status\}\s+onChange=\{\(e\) => \{ setDealerFilters\(prev => \(\{ \.\.\.prev, status: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Status<\/option>\s+\{filterOptions\.dealerStatuses\.map\(s => \(\s+<option key=\{s\} value=\{s\}>\{s\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.dealerStatuses} value={dealerFilters.status} onChange={v => { setDealerFilters(prev => ({ ...prev, status: v })); setPage(1); }} placeholder="Status" width="110px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '130px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{salesFilters\.zone\}\s+onChange=\{\(e\) => \{ setSalesFilters\(prev => \(\{ \.\.\.prev, zone: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Zones<\/option>\s+\{filterOptions\.salesZones\.map\(z => \(\s+<option key=\{z\} value=\{z\}>\{z\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.salesZones} value={salesFilters.zone} onChange={v => { setSalesFilters(prev => ({ ...prev, zone: v })); setPage(1); }} placeholder="Zones" width="130px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '160px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{sfaFilters\.employeeName\}\s+onChange=\{\(e\) => \{ setSfaFilters\(prev => \(\{ \.\.\.prev, employeeName: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Employees<\/option>\s+\{filterOptions\.logEmployees\.map\(emp => \(\s+<option key=\{emp\} value=\{emp\}>\{emp\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.logEmployees} value={sfaFilters.employeeName} onChange={v => { setSfaFilters(prev => ({ ...prev, employeeName: v })); setPage(1); }} placeholder="Employees" width="160px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '130px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{sfaFilters\.branch\}\s+onChange=\{\(e\) => \{ setSfaFilters\(prev => \(\{ \.\.\.prev, branch: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Branches<\/option>\s+\{filterOptions\.logBranches\.map\(b => \(\s+<option key=\{b\} value=\{b\}>\{b\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.logBranches} value={sfaFilters.branch} onChange={v => { setSfaFilters(prev => ({ ...prev, branch: v })); setPage(1); }} placeholder="Branches" width="130px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '140px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{sfaFilters\.route\}\s+onChange=\{\(e\) => \{ setSfaFilters\(prev => \(\{ \.\.\.prev, route: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Routes<\/option>\s+\{filterOptions\.logRoutes\.map\(r => \(\s+<option key=\{r\} value=\{r\}>\{r\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.logRoutes} value={sfaFilters.route} onChange={v => { setSfaFilters(prev => ({ ...prev, route: v })); setPage(1); }} placeholder="Routes" width="140px" />`
  },
  {
    find: /<select\s+className="form-control"\s+style=\{\{ width: '130px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{sfaFilters\.visitStatus\}\s+onChange=\{\(e\) => \{ setSfaFilters\(prev => \(\{ \.\.\.prev, visitStatus: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Statuses<\/option>\s+\{filterOptions\.logStatuses\.map\(s => \(\s+<option key=\{s\} value=\{s\}>\{s\}<\/option>\s+\)\)\}\s+<\/select>/g,
    replace: `<FilterSelect options={filterOptions.logStatuses} value={sfaFilters.visitStatus} onChange={v => { setSfaFilters(prev => ({ ...prev, visitStatus: v })); setPage(1); }} placeholder="Statuses" width="130px" />`
  }
];

let counter = 0;
replacements.forEach(r => {
  const matches = content.match(r.find);
  if (matches) {
    content = content.replace(r.find, r.replace);
    counter += matches.length;
  }
});

console.log('Replaced', counter, 'instances.');

// Also handle the VisitDate filter separately because it has a slightly different map body:
const visitDateRegex = /<select\s+className="form-control"\s+style=\{\{ width: '140px', padding: '6px 10px', fontSize: '0.8rem' \}\}\s+value=\{sfaFilters\.visitDate\}\s+onChange=\{\(e\) => \{ setSfaFilters\(prev => \(\{ \.\.\.prev, visitDate: e\.target\.value \}\)\); setPage\(1\); \}\}\s+>\s+<option value="ALL">All Visit Dates<\/option>\s+\{filterOptions\.logVisitDates\.map\(d => \{\s+let disp = d;\s+if \(disp && disp\.includes\('T'\)\) disp = disp\.split\('T'\)\[0\];\s+return <option key=\{d\} value=\{disp\}>\{disp\}<\/option>;\s+\}\)\}\s+<\/select>/g;

if (content.match(visitDateRegex)) {
  content = content.replace(visitDateRegex, `<FilterSelect options={filterOptions.logVisitDates.map(d => d && d.includes('T') ? d.split('T')[0] : d)} value={sfaFilters.visitDate} onChange={v => { setSfaFilters(prev => ({ ...prev, visitDate: v })); setPage(1); }} placeholder="Visit Dates" width="140px" />`);
  counter++;
}

fs.writeFileSync(file, content);
console.log('Total select filters successfully replaced:', counter);
