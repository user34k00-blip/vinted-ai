# vinted-ai

Site Vercel pour generer des annonces Vinted et debloquer des fonctions premium.

## Ce qui a change

Le mode premium `Changer le fond` de `api/photo-enhance.js` ne renvoie plus seulement un prompt.
Il appelle maintenant l'API Images OpenAI cote serveur et renvoie directement l'image modifiee a l'utilisateur.

Le mode `Ameliorer la photo` reste sur une analyse guidee via Anthropic.

## Variables d'environnement

### Requises pour le changement de fond IA

- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL=gpt-image-1` (optionnel, par defaut `gpt-image-1`)

### Requises pour les autres fonctions IA deja presentes

- `ANTHROPIC_API_KEY`

### Utilisees par le premium / auth / billing

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_SECRET`
- `STRIPE_SECRET`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `GMAIL_USER`
- `GMAIL_PASS`
- `APP_URL`

## Important

Un abonnement ChatGPT Business ne fournit pas directement une cle API pour ton site.
Pour cette integration, il faut creer une cle cote plateforme OpenAI (`platform.openai.com`) et la stocker seulement sur le serveur.
