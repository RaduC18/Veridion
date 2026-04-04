import fs from 'fs'
import { stringify } from 'querystring';

const dir = './webappanalyzer/src/technologies';
const files = fs.readdirSync(dir, 'utf8');

let technologies = {};

for(const file of files){
    const data = JSON.parse(fs.readFileSync(dir + `/${file}`), 'utf8');
    technologies = {
        ...technologies,
        ...data
    }
}

fs.writeFileSync('./result.json', JSON.stringify(technologies, null, 2));