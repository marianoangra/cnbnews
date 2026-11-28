"""Testes do montar_boletim (sem ffmpeg/Piper: só o comportamento de falha)."""
import datetime as dt
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


class TestBoletimVelhoNuncaFica(unittest.TestCase):
    def test_falha_no_meio_apaga_o_boletim_da_hora_anterior(self):
        with tempfile.TemporaryDirectory() as tv, tempfile.TemporaryDirectory() as radio:
            os.environ["CNB_TV_DIR"], os.environ["CNB_RADIO_DIR"] = tv, radio
            import importlib
            import montar_boletim as M
            importlib.reload(M)
            os.makedirs(M.SAIDA)
            velho = os.path.join(M.SAIDA, "proximo-completo.mp3")
            open(velho, "wb").write(b"boletim das 9h")

            def quebra(*a, **k):
                raise RuntimeError("piper caiu")
            M.carregar_segmentos = quebra
            with self.assertRaises(RuntimeError):
                M.montar("completo", dt.datetime(2026, 11, 28, 12, 57, tzinfo=dt.timezone.utc))
            self.assertFalse(os.path.exists(velho), "boletim da hora anterior não pode ir ao ar com a hora errada")


if __name__ == "__main__":
    unittest.main()
