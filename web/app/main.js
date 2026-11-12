/* main.js: 앱 진입점. 셸과 화면 모듈을 불러온 뒤 부팅한다.
   새 화면 모듈은 여기에 import 한 줄을 더한다(운영 화면 admin.js는 #/admin을 열 때 shell.js가 따로 불러온다). */
import { boot } from './shell.js';
import './screens/home.js';
import './screens/wiki.js';
import './screens/memos.js';
import './screens/agent.js';
import './screens/sessions.js';
import './screens/settings.js';

boot();
