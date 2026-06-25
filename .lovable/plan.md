Voy a rehacer el envío SMTP de campañas para que se parezca más a un envío de mailbox/cold-email tipo Instantly y quitar el bloqueo que añadí por DKIM.

Importante: ningún código puede garantizar “siempre inbox”, porque Gmail/Outlook deciden por reputación, historial del dominio, engagement, quejas, contenido y autenticación. Pero sí puedo dejar el SMTP mucho más limpio y menos “bulk/fingerprint”.

Plan de cambios:

1. Quitar el bloqueo SPF/DKIM/DMARC
- Eliminar la validación que ahora salta dominios sin DKIM.
- Las cuentas volverán a enviar aunque el dominio no tenga DKIM perfecto.
- Mantendré los logs de errores SMTP, pero no frenaré campañas por DNS.

2. Rehacer headers SMTP en modo “mailbox humano”
- Usar un set mínimo de headers:
  - Date
  - From
  - To
  - Subject
  - Message-ID
  - MIME-Version
  - Content-Type
  - Content-Transfer-Encoding
- Quitar headers que pueden parecer envío masivo si no están perfectamente soportados:
  - List-Unsubscribe
  - List-Unsubscribe-Post
  - Feedback-ID
  - X-* tracking / prioridad / mailer
  - Reply-To duplicado cuando es igual al From
- Mantener In-Reply-To y References solo en follow-ups para conservar hilos.

3. Ajustar EHLO/SMTP para IONOS de forma más natural
- Usar el hostname SMTP real como EHLO en vez del dominio del remitente, porque `EHLO dominio.com` puede verse raro si no resuelve como servidor emisor.
- Validar respuestas SMTP de MAIL FROM y DATA con más cuidado.
- Mantener STARTTLS/465 correctamente.

4. Contenido ultra limpio por defecto
- Mantener texto plano por defecto, sin tracking, sin imágenes y sin HTML pesado.
- No borrar agresivamente el mensaje si el usuario escribió un enlace; en vez de eso, normalizarlo para no romper el contenido.
- Firma: incluirla solo si no mete HTML/links sospechosos; si no, convertirla a texto plano.

5. Cadencia y protección de reputación
- Mantener 1 correo por cuenta cada 7-9 minutos.
- Mantener máximo duro de 30/día por cuenta.
- Añadir variación pequeña extra por cuenta para que no parezca una tanda perfectamente sincronizada.

6. Desplegar la función
- Después de editar `process-campaign-queue`, desplegaré la función para que el cambio se aplique de verdad.

Resultado esperado:
- No se bloquearán tus cuentas por DKIM.
- El SMTP quedará mucho más parecido a un envío limpio de mailbox, sin fingerprints de bulk.
- Debería mejorar la colocación en inbox frente al SMTP actual, aunque la entregabilidad final seguirá dependiendo también de reputación del dominio/cuenta y del texto de cada campaña.