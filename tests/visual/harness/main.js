import '../../../src/app.css';
import '../../../src/styles.css';
import { mount } from 'svelte';
import Harness from './Harness.svelte';
const target = document.getElementById('app');
if (!target) throw new Error('Missing visual test mount');
mount(Harness, { target });
