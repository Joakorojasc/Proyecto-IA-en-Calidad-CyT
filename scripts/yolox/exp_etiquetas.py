"""Configuración de YOLOX para Quality AI: 2 clases (frontal, trasera), modelo "tiny" (rápido en un PC sin GPU).

Se usa con el repositorio oficial de YOLOX:
    python tools/train.py -f exp_etiquetas.py -d 1 -b 16 --fp16 -o -c yolox_tiny.pth
"""
import os

from yolox.exp import Exp as MyExp


class Exp(MyExp):
    def __init__(self):
        super().__init__()
        # tamaño "tiny": ~5 millones de parámetros
        self.depth = 0.33
        self.width = 0.375
        self.exp_name = "etiquetas"

        # datos (los arma scripts/yolox/preparar_dataset.py)
        self.data_dir = os.environ.get("QA_DATASET", "datasets/etiquetas")
        self.train_ann = "train.json"
        self.val_ann = "val.json"
        self.num_classes = 2            # 0 = frontal, 1 = trasera

        # imágenes de 416 px: suficiente para etiquetas grandes y rápido al usarlo en vivo
        self.input_size = (416, 416)
        self.test_size = (416, 416)
        self.multiscale_range = 3
        self.random_size = (10, 20)

        # pocas imágenes: más épocas y aumentos de datos fuertes (color, escala, mosaico)
        self.max_epoch = 120
        self.no_aug_epochs = 15
        self.warmup_epochs = 3
        self.eval_interval = 5
        self.mosaic_scale = (0.5, 1.5)
        self.enable_mixup = False       # mezclar dos fotos confunde etiquetas parciales
        self.hsv_prob = 1.0             # varía luz y color: el modelo no depende de una sola iluminación
        self.flip_prob = 0.5
        self.degrees = 5.0
        self.shear = 1.0

        self.data_num_workers = 2
