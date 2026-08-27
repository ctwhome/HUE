<script lang="ts">
	let { form } = $props();
</script>

<svelte:head>
	<title>Sign in | HUE</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="login-shell">
	<section aria-labelledby="login-title">
		<p class="mark">HUE</p>
		<h1 id="login-title">Open your workspace</h1>
		<p class="intro">Enter the access secret configured on the computer running HUE.</p>
		<form method="POST">
			<label for="secret">Access secret</label>
			<input id="secret" name="secret" type="password" autocomplete="current-password" required />
			{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
			<button type="submit">Sign in</button>
		</form>
		<p class="warning">Use HUE only over HTTPS on a trusted LAN or tailnet.</p>
	</section>
</main>

<style>
	:global(html) {
		background: #080808;
		color-scheme: dark;
	}
	:global(body) {
		margin: 0;
	}
	.login-shell {
		display: grid;
		min-height: 100svh;
		place-items: center;
		padding: 24px;
		background: radial-gradient(circle at 50% 15%, #252027 0, #0c0b0d 40%, #080808 72%);
		font-family: Inter, system-ui, sans-serif;
	}
	section {
		width: min(100%, 390px);
		padding: 36px;
		border: 1px solid #302d32;
		border-radius: 22px;
		background: rgb(15 14 16 / 92%);
		box-shadow: 0 28px 90px rgb(0 0 0 / 45%);
	}
	.mark {
		margin: 0 0 34px;
		color: #f472b6;
		font-size: 0.78rem;
		font-weight: 750;
		letter-spacing: 0.22em;
	}
	h1 {
		margin: 0;
		font-size: clamp(2rem, 8vw, 2.75rem);
		letter-spacing: -0.055em;
		line-height: 1;
	}
	.intro,
	.warning {
		color: #aaa4ad;
		line-height: 1.55;
	}
	.intro {
		margin: 18px 0 30px;
	}
	form {
		display: grid;
		gap: 10px;
	}
	label {
		font-size: 0.82rem;
		font-weight: 650;
	}
	input,
	button {
		min-height: 48px;
		border-radius: 11px;
		font: inherit;
	}
	input {
		border: 1px solid #3b373e;
		background: #080808;
		color: #fff;
		padding: 0 14px;
	}
	input:focus-visible {
		outline: 2px solid #f472b6;
		outline-offset: 2px;
	}
	button {
		margin-top: 6px;
		border: 0;
		background: #f472b6;
		color: #210b17;
		font-weight: 750;
		cursor: pointer;
	}
	button:hover {
		background: #f9a8d4;
	}
	.error {
		margin: 2px 0;
		color: #fca5a5;
		font-size: 0.86rem;
	}
	.warning {
		margin: 24px 0 0;
		font-size: 0.76rem;
	}
	@media (max-width: 430px) {
		.login-shell {
			padding: 14px;
		}
		section {
			padding: 28px 22px;
		}
	}
</style>
