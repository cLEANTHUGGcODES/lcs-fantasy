@import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@500&display=swap');
*{
    padding: 0;
    margin: 0; 
    font-family: 'Quicksand', sans-serif;
}
body{
    background:#f44336;
}
.container{
    position: absolute;
    top: 50%;   left: 50%;
    transform: translate(-50%,-50%) ;
    width: 370px;   height: 530px;
    border-radius: 30px;
    transition: .5s;
}
/* .container:hover{
    transform: perspective(1000px) translate(-50%,-50%) rotateY(180deg);
} */
.container img{
    display: inline-block;
    width: 100%;   height: 100%;
    border-radius: 30px;
    backface-visibility: hidden; 
    transform: perspective(1000px) rotateY(0deg);
    transition: .5s; 
    box-shadow: 0 25px 15px rgb(0 0 0 / 50%)

}
.container:hover img{
    transform: perspective(1000px) rotateY(180deg);
}
.container .content{
    position: absolute;
    top: 0;  left: 0;
    width: 100%;   height: 100%;
    border-radius: 30px;
    backface-visibility: hidden;  
    transform: perspective(1000px) rotateY(-180deg);
    background: #fff;
    transition: .5s;
    box-shadow: 0 25px 15px rgb(0 0 0 / 50%)

}
.container:hover .content{
    transform: perspective(1000px) rotateY(0);
} 
.container .content h1{
    color: #f00;
    text-align: center;   line-height: 530px;
}